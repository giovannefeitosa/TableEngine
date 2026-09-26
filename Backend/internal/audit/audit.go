package audit

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"

	"tableengine/internal/database"
)

type AuditEntry struct {
	SysID     uuid.UUID   `json:"sys_id"`
	TableName string      `json:"table_name"`
	Operation string      `json:"operation"`
	FieldName string      `json:"field_name"`
	OldValue  interface{} `json:"old_value"`
	NewValue  interface{} `json:"new_value"`
	ChangedOn time.Time   `json:"changed_on"`
	ChangedBy ActorInfo   `json:"changed_by"`
}

type ActorInfo struct {
	SysID     uuid.UUID `json:"sys_id"`
	UserName  string    `json:"user_name"`
	FirstName string    `json:"first_name,omitempty"`
	LastName  string    `json:"last_name,omitempty"`
}

type Engine struct {
	db *database.DB
}

func NewEngine(db *database.DB) *Engine {
	return &Engine{db: db}
}

// GetAuditHistory retrieves the complete audit timeline for a record.
func (e *Engine) GetAuditHistory(ctx context.Context, docID uuid.UUID) ([]AuditEntry, error) {
	query := `
		SELECT a.sys_id, a.table_name, a.operation, a.field_name, a.old_value, a.new_value, a.changed_on,
		       u.sys_id, u.user_name, u.first_name, COALESCE(u.last_name, '')
		FROM sys_audit a
		JOIN sys_user u ON u.sys_id = a.changed_by
		WHERE a.document_id = $1
		ORDER BY a.changed_on DESC;
	`

	rows, err := e.db.Pool.Query(ctx, query, docID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := make([]AuditEntry, 0)
	for rows.Next() {
		var (
			entry      AuditEntry
			oldJSON    []byte
			newJSON    []byte
			actorSysID uuid.UUID
			actorUName string
			actorFName string
			actorLName string
		)

		if err := rows.Scan(
			&entry.SysID, &entry.TableName, &entry.Operation, &entry.FieldName,
			&oldJSON, &newJSON, &entry.ChangedOn,
			&actorSysID, &actorUName, &actorFName, &actorLName,
		); err != nil {
			return nil, err
		}

		entry.ChangedBy = ActorInfo{
			SysID:     actorSysID,
			UserName:  actorUName,
			FirstName: actorFName,
			LastName:  actorLName,
		}

		if len(oldJSON) > 0 {
			_ = json.Unmarshal(oldJSON, &entry.OldValue)
		}
		if len(newJSON) > 0 {
			_ = json.Unmarshal(newJSON, &entry.NewValue)
		}

		entries = append(entries, entry)
	}

	return entries, nil
}
