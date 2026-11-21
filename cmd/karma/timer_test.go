package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	lru "github.com/hashicorp/golang-lru/v2"
)

func TestRefreshAlwaysStartsFreshPull(t *testing.T) {
	apiCache, _ = lru.New[string, []byte](16)

	pullFromAlertmanager()
	first := lastPullStart

	// a pull that completed just now may predate the change the caller made,
	// so refresh must not reuse it
	rec := httptest.NewRecorder()
	refresh(rec, httptest.NewRequest(http.MethodPost, "/refresh", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status code: %d", rec.Code)
	}
	if !lastPullStart.After(first) {
		t.Fatal("refresh reused an older pull instead of starting a new one")
	}
}
