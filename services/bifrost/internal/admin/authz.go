// services/bifrost/internal/admin/authz.go
package admin

import (
	"context"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
	"github.com/drewpayment/orbit/proto/pkg/svcauth"
)

// rpcPolicy is the authorization an admin RPC requires beyond a valid service
// token (which the svcauth interceptor already demands for every non-exempt
// method).
type rpcPolicy int

const (
	// policyPlatformAdmin requires the "adm" claim. It is the zero value on
	// purpose: a method with no entry in methodPolicies is admin-only, so a
	// newly added RPC fails closed until someone decides otherwise.
	policyPlatformAdmin rpcPolicy = iota
	// policyWorkspaceScoped admits a platform admin or a token carrying a
	// workspace claim. orbit-www signs wid only after verifying the user is a
	// member of that workspace, so this keeps unscoped tokens out. Bifrost does
	// not record which workspace owns a virtual cluster, so it cannot check
	// that wid owns the cluster named in the request — orbit-www must authorize
	// the virtual cluster before calling.
	policyWorkspaceScoped
)

// methodPolicies lists the RPCs that are not platform-admin only. Everything
// that mutates or discloses gateway configuration (virtual clusters,
// credentials, policies, ACLs, full config, status) is deliberately absent and
// therefore admin-only. Only the per-virtual-cluster consumer-group operations
// that tenants use from the portal are admitted with a workspace claim.
var methodPolicies = map[string]rpcPolicy{
	gatewayv1.BifrostAdminService_ListConsumerGroups_FullMethodName:        policyWorkspaceScoped,
	gatewayv1.BifrostAdminService_DescribeConsumerGroup_FullMethodName:     policyWorkspaceScoped,
	gatewayv1.BifrostAdminService_ResetConsumerGroupOffsets_FullMethodName: policyWorkspaceScoped,
}

func policyFor(fullMethod string) rpcPolicy {
	return methodPolicies[fullMethod] // zero value: policyPlatformAdmin
}

// authorize applies the method's policy to the identity the svcauth
// interceptor injected.
func authorize(ctx context.Context, fullMethod string) error {
	id, ok := svcauth.IdentityFromContext(ctx)
	if !ok {
		return status.Error(codes.Unauthenticated, "no verified identity in context")
	}
	if id.PlatformAdmin {
		return nil
	}
	if policyFor(fullMethod) == policyWorkspaceScoped && id.WorkspaceID != "" {
		return nil
	}
	return status.Error(codes.PermissionDenied, "insufficient privileges for this admin RPC")
}

// policyUnaryInterceptor enforces methodPolicies. It must run after
// svcauth.UnaryServerInterceptor in the chain. Exempt methods (health,
// reflection) never carry an identity and are passed through untouched.
func policyUnaryInterceptor(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
	if _, isAdminRPC := adminRPCs[info.FullMethod]; !isAdminRPC {
		return handler(ctx, req)
	}
	if err := authorize(ctx, info.FullMethod); err != nil {
		return nil, err
	}
	return handler(ctx, req)
}

// adminRPCs is the set of methods the policy interceptor governs: exactly the
// RPCs of BifrostAdminService, derived from the generated service descriptor so
// it cannot drift from the proto.
var adminRPCs = func() map[string]struct{} {
	set := make(map[string]struct{}, len(gatewayv1.BifrostAdminService_ServiceDesc.Methods))
	for _, m := range gatewayv1.BifrostAdminService_ServiceDesc.Methods {
		set["/"+gatewayv1.BifrostAdminService_ServiceDesc.ServiceName+"/"+m.MethodName] = struct{}{}
	}
	return set
}()
