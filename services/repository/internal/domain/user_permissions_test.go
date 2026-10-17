package domain

import "testing"

// Regression tests for issue #159: the role -> permission matrix in
// User.HasPermission must follow the role hierarchy (Admin is a superset of
// Developer) while keeping system-level permissions SuperAdmin-only.

func TestHasPermission_AdminInheritsDeveloperPermissions(t *testing.T) {
	admin := &User{Role: RoleAdmin}
	for _, p := range developerPermissions {
		if !admin.HasPermission(p) {
			t.Errorf("admin should hold developer permission %q", p)
		}
		if !(&User{Role: RoleDeveloper}).HasPermission(p) {
			t.Errorf("developer should hold %q", p)
		}
	}
}

func TestHasPermission_HierarchyIsMonotonic(t *testing.T) {
	// Every permission held by a role must also be held by every role with a
	// higher level, except for the SuperAdmin wildcard roles, which are checked
	// separately below.
	roles := []UserRole{RoleGuest, RoleViewer, RoleDeveloper, RoleAdmin}
	for i, lower := range roles {
		for _, higher := range roles[i+1:] {
			for _, p := range rolePermissions[lower] {
				if !(&User{Role: higher}).HasPermission(p) {
					t.Errorf("%s (level %d) should inherit %q from %s (level %d)",
						higher, higher.GetLevel(), p, lower, lower.GetLevel())
				}
			}
		}
	}
}

func TestHasPermission_SystemPermissionsAreSuperAdminOnly(t *testing.T) {
	systemPerms := []string{"system.configure", "system.monitor", "audit.read", "role.create", "role.update"}
	for _, p := range systemPerms {
		if !(&User{Role: RoleSuperAdmin}).HasPermission(p) {
			t.Errorf("super_admin should hold %q", p)
		}
		for _, r := range []UserRole{RoleAdmin, RoleDeveloper, RoleViewer, RoleGuest} {
			if (&User{Role: r}).HasPermission(p) {
				t.Errorf("%s must NOT hold %q", r, p)
			}
		}
	}
}

func TestHasPermission_AdminDoesNotShareMutableSlices(t *testing.T) {
	// Admin's list is built from developerPermissions; appending must not
	// have mutated the Developer list.
	if (&User{Role: RoleDeveloper}).HasPermission("user.create") {
		t.Error("developer must not gain admin-only permission user.create")
	}
	if (&User{Role: RoleDeveloper}).HasPermission("schema.delete") {
		t.Error("developer must not gain admin-only permission schema.delete")
	}
}

func TestHasPermission_UnknownRoleDenied(t *testing.T) {
	if (&User{Role: UserRole("bogus")}).HasPermission("schema.read") {
		t.Error("unknown role must be denied")
	}
}
