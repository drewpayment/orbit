package security

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/drewpayment/orbit/services/repository/internal/domain"
)

// The role fixtures in rbac_security_test.go are a copy of the production
// permission matrix (domain.User.HasPermission). This test keeps them honest:
// every fixture role must agree with production on every permission either
// side knows about, so fixtures cannot silently drift (issue #159).
func TestFixtureRolesMatchProduction(t *testing.T) {
	roles := []Role{SuperAdminRole, AdminRole, DeveloperRole, ViewerRole, GuestRole}

	// Probe set: every permission mentioned by any fixture role plus the
	// system-level ones the tests care about.
	probe := map[string]bool{
		"system.configure": true, "system.monitor": true, "audit.read": true,
		"role.create": true, "role.update": true, "codegen.execute": true,
		"repository.create": true, "repository.read": true, "repository.update": true,
	}
	for _, r := range roles {
		for _, p := range r.Permissions {
			probe[p] = true
		}
	}

	for _, role := range roles {
		prod := &domain.User{Role: domain.UserRole(role.Name)}
		assert.Equal(t, role.Level, prod.Role.GetLevel(), "level mismatch for %s", role.Name)

		for p := range probe {
			fixtureHas := checkUserPermission(createTestUser("u", role), p)
			// Super admin is wildcard-based in production and does not include
			// repository.* / codegen.* there; only compare what the fixture
			// lists explicitly in that case.
			assert.Equal(t, fixtureHas, prod.HasPermission(p),
				"fixture and production disagree for role %s on %q", role.Name, p)
		}
	}
}
