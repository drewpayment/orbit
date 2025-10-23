package backstage

import (
	"context"
	"fmt"
	"time"

	"github.com/sony/gobreaker"
)

// ClientWithCircuitBreaker wraps the Backstage client with circuit breaker pattern
// for resilience against failures
type ClientWithCircuitBreaker struct {
	baseClient     *Client
	circuitBreaker *gobreaker.CircuitBreaker
}

// NewClientWithCircuitBreaker creates a new client with circuit breaker
func NewClientWithCircuitBreaker(baseURL string) *ClientWithCircuitBreaker {
	settings := gobreaker.Settings{
		Name:        "backstage-api",
		MaxRequests: 3,                // Max requests allowed in HALF-OPEN state
		Interval:    10 * time.Second, // Reset failure counter after this duration
		Timeout:     30 * time.Second, // Duration to wait before trying HALF-OPEN
		ReadyToTrip: func(counts gobreaker.Counts) bool {
			// Open circuit if failure rate >= 60% and at least 5 requests
			failureRatio := float64(counts.TotalFailures) / float64(counts.Requests)
			return counts.Requests >= 5 && failureRatio >= 0.6
		},
		OnStateChange: func(name string, from gobreaker.State, to gobreaker.State) {
			// Log state changes (in production, send alerts)
			fmt.Printf("[Circuit Breaker] %s: %s -> %s\n", name, from.String(), to.String())

			// TODO: Send alert if circuit opens
			if to == gobreaker.StateOpen {
				fmt.Printf("[Alert] Backstage circuit breaker OPEN - service degraded\n")
			}
		},
	}

	return &ClientWithCircuitBreaker{
		baseClient:     NewClient(baseURL),
		circuitBreaker: gobreaker.NewCircuitBreaker(settings),
	}
}

// ProxyRequest executes the request with circuit breaker protection
func (c *ClientWithCircuitBreaker) ProxyRequest(
	ctx context.Context,
	req *ProxyRequest,
) (*ProxyResponse, error) {
	// Execute with circuit breaker
	result, err := c.circuitBreaker.Execute(func() (interface{}, error) {
		return c.baseClient.ProxyRequest(ctx, req)
	})

	if err != nil {
		// Circuit breaker is open or request failed
		if err == gobreaker.ErrOpenState {
			return &ProxyResponse{
				StatusCode:   503,
				ErrorMessage: "Backstage service unavailable (circuit breaker open)",
			}, fmt.Errorf("backstage service unavailable (circuit breaker open)")
		}
		return nil, err
	}

	return result.(*ProxyResponse), nil
}

// HealthCheck performs health check with circuit breaker
func (c *ClientWithCircuitBreaker) HealthCheck(ctx context.Context) error {
	_, err := c.circuitBreaker.Execute(func() (interface{}, error) {
		return nil, c.baseClient.HealthCheck(ctx)
	})

	return err
}

// GetState returns the current circuit breaker state
func (c *ClientWithCircuitBreaker) GetState() gobreaker.State {
	return c.circuitBreaker.State()
}
