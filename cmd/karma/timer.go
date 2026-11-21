package main

import (
	"fmt"
	"log/slog"
	"net/http"
	"runtime"
	"sync"
	"time"

	"github.com/prymitive/karma/internal/alertmanager"
)

const (
	maxTries = 2
)

var (
	// pullMu serialises pulls, so a manual refresh can't overlap the ticker
	pullMu sync.Mutex
	// lastPullStart is when the most recent pull started, guarded by pullMu
	lastPullStart time.Time
)

func pullFromAlertmanager() {
	pullMu.Lock()
	defer pullMu.Unlock()
	pullLocked()
}

// pullLocked must be called with pullMu held
func pullLocked() {
	lastPullStart = time.Now()

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

// refresh pulls from all Alertmanagers right now and returns once done.
// A pull that started before the request arrived may have missed whatever
// change the caller is waiting for, so it's never reused. Requests that queue
// up behind a running pull share the next one.
func refresh(w http.ResponseWriter, _ *http.Request) {
	arrived := time.Now()
	pullMu.Lock()
	if !lastPullStart.After(arrived) {
		pullLocked()
	}
	pullMu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte("{}\n"))
}
