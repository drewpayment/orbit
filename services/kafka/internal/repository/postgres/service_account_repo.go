package postgres

import (
	"context"
	"errors"

	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ServiceAccountRepository implements service.ServiceAccountRepository with PostgreSQL.
type ServiceAccountRepository struct {
	db DBTX
}

func NewServiceAccountRepository(db DBTX) *ServiceAccountRepository {
	return &ServiceAccountRepository{db: db}
}

const saColumns = `id, workspace_id, name, type, status, created_by, created_at, updated_at`

func (r *ServiceAccountRepository) Create(ctx context.Context, account *domain.KafkaServiceAccount) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO kafka_service_accounts (id, workspace_id, name, type, status, created_by, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		account.ID, account.WorkspaceID, account.Name,
		string(account.Type), string(account.Status),
		account.CreatedBy, account.CreatedAt, account.UpdatedAt)
	return err
}

func (r *ServiceAccountRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.KafkaServiceAccount, error) {
	row := r.db.QueryRow(ctx, `SELECT `+saColumns+` FROM kafka_service_accounts WHERE id = $1`, id)
	return scanServiceAccount(row)
}

func (r *ServiceAccountRepository) List(ctx context.Context, workspaceID uuid.UUID) ([]*domain.KafkaServiceAccount, error) {
	rows, err := r.db.Query(ctx,
		`SELECT `+saColumns+` FROM kafka_service_accounts WHERE workspace_id = $1 ORDER BY created_at DESC`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var accounts []*domain.KafkaServiceAccount
	for rows.Next() {
		a, err := scanServiceAccount(rows)
		if err != nil {
			return nil, err
		}
		accounts = append(accounts, a)
	}
	return accounts, rows.Err()
}

func (r *ServiceAccountRepository) Update(ctx context.Context, account *domain.KafkaServiceAccount) error {
	tag, err := r.db.Exec(ctx,
		`UPDATE kafka_service_accounts SET workspace_id=$2, name=$3, type=$4, status=$5, updated_at=$6
		 WHERE id=$1`,
		account.ID, account.WorkspaceID, account.Name,
		string(account.Type), string(account.Status), account.UpdatedAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrServiceAccountNotFound
	}
	return nil
}

func scanServiceAccount(s scanner) (*domain.KafkaServiceAccount, error) {
	var a domain.KafkaServiceAccount
	var accountType, status string
	err := s.Scan(&a.ID, &a.WorkspaceID, &a.Name, &accountType, &status,
		&a.CreatedBy, &a.CreatedAt, &a.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	a.Type = domain.ServiceAccountType(accountType)
	a.Status = domain.ServiceAccountStatus(status)
	return &a, nil
}
