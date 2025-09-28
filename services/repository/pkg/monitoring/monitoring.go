package monitoring

import (
	"net/http"
	_ "net/http/pprof" // Import pprof for performance profiling
)

// EnablePprof starts a pprof server on the given port for performance monitoring
func EnablePprof(port string) {
	go func() {
		http.ListenAndServe(":"+port, nil)
	}()
}