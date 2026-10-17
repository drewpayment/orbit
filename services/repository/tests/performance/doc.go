// Package performance holds load/latency tests that require live services
// (localhost:8001/8002) and, for auth_perf_test.go, a generated gRPC client
// (authv1.NewAuthServiceClient) that does not exist yet. They are behind the
// `integration` build tag so `go test ./...` stays hermetic. Run with:
//
//	go test -tags integration ./tests/performance/...
package performance
