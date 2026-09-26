package numbering

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"tableengine/internal/auth"
	"tableengine/internal/database"
)

type ConfigRequest struct {
	TableID       uuid.UUID `json:"table_id"`
	FieldName     string    `json:"field_name"`
	Prefix        string    `json:"prefix"`
	MinimumDigits int       `json:"minimum_digits"`
	StartNumber   int64     `json:"start_number"`
}

type ConfigResponse struct {
	SysID         uuid.UUID `json:"sys_id"`
	TableID       uuid.UUID `json:"table_id"`
	FieldName     string    `json:"field_name"`
	Prefix        string    `json:"prefix"`
	MinimumDigits int       `json:"minimum_digits"`
	StartNumber   int64     `json:"start_number"`
	IsActive      bool      `json:"is_active"`
}

type Engine struct {
	db *database.DB
}

func NewEngine(db *database.DB) *Engine {
	return &Engine{db: db}
}

// ConfigureNumbering creates a number sequence definition and its counter.
func (e *Engine) ConfigureNumbering(ctx context.Context, req ConfigRequest, userCtx *auth.SecurityContext) (*ConfigResponse, error) {
	prefix := strings.ToUpper(strings.TrimSpace(req.Prefix))
	if len(prefix) < 1 || len(prefix) > 3 {
		return nil, errors.New("o prefixo deve conter de 1 a 3 caracteres")
	}

	fieldName := strings.TrimSpace(req.FieldName)
	if fieldName == "" {
		fieldName = "number"
	}

	minDigits := req.MinimumDigits
	if minDigits < 1 || minDigits > 19 {
		minDigits = 7
	}

	startNum := req.StartNumber
	if startNum < 1 {
		startNum = 1
	}

	var res ConfigResponse

	err := auth.ExecuteInTx(ctx, e.db, userCtx, func(tx pgx.Tx) error {
		var numID uuid.UUID
		err := tx.QueryRow(ctx, `
			INSERT INTO sys_number (table_id, field_name, prefix, minimum_digits, start_number)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING sys_id, is_active
		`, req.TableID, fieldName, prefix, minDigits, startNum).Scan(&numID, &res.IsActive)
		if err != nil {
			return fmt.Errorf("falha ao registrar sys_number: %w", err)
		}

		_, err = tx.Exec(ctx, `
			INSERT INTO sys_number_counter (number_id, last_value)
			VALUES ($1, $2)
		`, numID, startNum-1)
		if err != nil {
			return fmt.Errorf("falha ao inicializar sys_number_counter: %w", err)
		}

		res.SysID = numID
		res.TableID = req.TableID
		res.FieldName = fieldName
		res.Prefix = prefix
		res.MinimumDigits = minDigits
		res.StartNumber = startNum
		return nil
	})

	if err != nil {
		return nil, err
	}
	return &res, nil
}

// GetNextNumber finds the applicable number configuration for a table (or closest ancestor) and generates next formatted number.
func (e *Engine) GetNextNumber(ctx context.Context, tx pgx.Tx, tableID uuid.UUID, fieldName string) (string, error) {
	// Recursive CTE to find number configuration from current table upwards
	cte := `
		WITH RECURSIVE lineage AS (
			SELECT sys_id, super_class_id, 0 AS depth
			FROM sys_db_object WHERE sys_id = $1
			UNION ALL
			SELECT p.sys_id, p.super_class_id, l.depth + 1
			FROM sys_db_object p
			JOIN lineage l ON l.super_class_id = p.sys_id
		)
		SELECT n.sys_id
		FROM lineage l
		JOIN sys_number n ON n.table_id = l.sys_id
		WHERE n.field_name = $2 AND n.is_active = TRUE
		ORDER BY l.depth ASC
		LIMIT 1;
	`

	var numConfigID uuid.UUID
	err := tx.QueryRow(ctx, cte, tableID, fieldName).Scan(&numConfigID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil // No auto numbering configured
		}
		return "", err
	}

	var generatedNumber string
	err = tx.QueryRow(ctx, "SELECT sys_next_number($1)", numConfigID).Scan(&generatedNumber)
	if err != nil {
		return "", fmt.Errorf("falha ao gerar próximo número: %w", err)
	}

	return generatedNumber, nil
}
