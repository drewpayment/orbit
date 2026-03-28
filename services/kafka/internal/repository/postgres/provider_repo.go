package postgres

import (
	"context"

	"github.com/drewpayment/orbit/services/kafka/internal/domain"
)

// ProviderRepository implements service.ProviderRepository.
// Providers are read-only hardcoded values — no database table needed.
type ProviderRepository struct{}

func NewProviderRepository() *ProviderRepository {
	return &ProviderRepository{}
}

func (r *ProviderRepository) GetByID(_ context.Context, id string) (*domain.KafkaProvider, error) {
	providers := domain.DefaultProviders()
	for i := range providers {
		if providers[i].ID == id {
			return &providers[i], nil
		}
	}
	return nil, nil
}

func (r *ProviderRepository) List(_ context.Context) ([]*domain.KafkaProvider, error) {
	providers := domain.DefaultProviders()
	result := make([]*domain.KafkaProvider, len(providers))
	for i := range providers {
		result[i] = &providers[i]
	}
	return result, nil
}
