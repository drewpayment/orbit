package actions_test

import (
	"context"
	"errors"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// stubTokenService and stubCatalogClient exist only so DefaultActions returns
// its full set in TestDescriptorActions_CoversEveryDefaultAction. Neither is
// ever called.
type stubTokenService struct{}

func (stubTokenService) GetInstallationToken(context.Context, string) (string, error) {
	return "", errors.New("stub")
}

type stubCatalogClient struct{}

func (stubCatalogClient) RegisterEntity(context.Context, services.CatalogEntityRegisterInput) (*services.CatalogEntityRegisterResult, error) {
	return nil, errors.New("stub")
}
