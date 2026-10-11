package grpc

import (
	"context"

	"github.com/drewpayment/orbit/proto/pkg/svcauth"
)

// testWS is the workspace the happy-path tests are authorized for and that the
// default mock resolvers report as every workflow's owner.
const testWS = "ws-1"

// wsCtx is a handler context carrying a verified identity authorized for testWS.
func wsCtx() context.Context { return ctxFor(testWS, false) }

// ctxFor builds a handler context as the svcauth interceptor would leave it.
func ctxFor(wid string, admin bool) context.Context {
	return svcauth.WithIdentity(context.Background(), svcauth.Identity{
		UserID:        "user-1",
		WorkspaceID:   wid,
		PlatformAdmin: admin,
	})
}
