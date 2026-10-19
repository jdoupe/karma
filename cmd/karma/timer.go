package main

import (
	"fmt"
	"log/slog"
	"runtime"
	"sync"
	"time"

	"github.com/prymitive/karma/internal/alertmanager"
)

const (
	maxTries = 2
	// minimum time between pulls requested via the API
	minManualPullInterval = 5 * time.Second
)

var (
	// serializes pulls so that API triggered ones never overlap with the timer
	pullMutex sync.Mutex
	lastPull  time.Time
)

// pullFromAlertmanagerThrottled runs a pull unless one finished recently.
// Returns true if a pull was executed.
func pullFromAlertmanagerThrottled() bool {
	pullMutex.Lock()
	defer pullMutex.Unlock()
	if time.Since(lastPull) < minManualPullInterval {
		return false
	}
	pullFromAlertmanagerLocked()
	return true
}

func pullFromAlertmanager() {
	pullMutex.Lock()
	defer pullMutex.Unlock()
	pullFromAlertmanagerLocked()
}

func pullFromAlertmanagerLocked() {
	defer func() { lastPull = time.Now() }()
	// always flush cache once we're done
	defer apiCache.Purge()

	slog.Info("Pulling latest alerts and silences from Alertmanager")

	upstreams := alertmanager.GetAlertmanagers()
	wg := sync.WaitGroup{}
	wg.Add(len(upstreams))

	for _, upstream := range upstreams {
		go func(am *alertmanager.Alertmanager) {
			slog.Info("Collecting alerts and silences", slog.String("alertmanager", am.Name))
			for i := 1; i <= maxTries; i++ {
				err := am.Pull()
				if err != nil {
					slog.Error(
						"Collection failed",
						slog.Any("error", err),
						slog.String("alertmanager", am.Name),
						slog.String("try", fmt.Sprintf("%d/%d", i, maxTries)),
					)
				} else {
					break
				}
			}
			wg.Done()
		}(upstream)
	}

	wg.Wait()

	slog.Info("Collection completed")
	runtime.GC()
}

// Tick is the background timer used to call PullFromAlertmanager
func Tick() {
	for range ticker.C {
		pullFromAlertmanager()
	}
}
