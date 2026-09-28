package fsm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"tableengine/internal/auth"
	"tableengine/internal/condition"
	"tableengine/internal/database"
)

type StateItem struct {
	SysID       uuid.UUID  `json:"sys_id"`
	TableID     *uuid.UUID `json:"table_id,omitempty"`
	TableName   string     `json:"table_name,omitempty"`
	Name        string     `json:"name"`
	Label       string     `json:"label"`
	Sequence    int        `json:"sequence"`
	IsActive    bool       `json:"is_active"`
	Color       string     `json:"color"`
	Description string     `json:"description,omitempty"`
}

type TransitionInfo struct {
	TransitionID       uuid.UUID  `json:"transition_id"`
	FromStateID        uuid.UUID  `json:"from_state_id"`
	FromState          string     `json:"from_state"`
	FromStateLabel     string     `json:"from_state_label"`
	ToStateID          uuid.UUID  `json:"to_state_id"`
	ToState            string     `json:"to_state"`
	ToStateLabel       string     `json:"to_state_label"`
	Label              string     `json:"label"`
	ActionName         string     `json:"action_name"`
	DefinedInTable     string     `json:"defined_in_table"`
	RequiresFields     []string   `json:"requires_fields,omitempty"`
	RequiredRoleID     *uuid.UUID `json:"required_role_id,omitempty"`
	ConditionTreeJSON  []byte     `json:"-"`
	OnTransitionAction []byte     `json:"-"`
}

type Engine struct {
	db          *database.DB
	authService *auth.Service
}

func NewEngine(db *database.DB, authService *auth.Service) *Engine {
	return &Engine{db: db, authService: authService}
}

// ListStates lists all states, optionally filtered by tableID or global.
func (e *Engine) ListStates(ctx context.Context, tableID *uuid.UUID) ([]StateItem, error) {
	var query string
	var args []interface{}

	if tableID != nil && *tableID != uuid.Nil {
		query = `
			SELECT s.sys_id, s.table_id, COALESCE(o.name, ''), s.name, s.label, s.sequence, s.is_active, s.color, COALESCE(s.description, '')
			FROM sys_state s
			LEFT JOIN sys_db_object o ON o.sys_id = s.table_id
			WHERE s.table_id = $1 OR s.table_id IS NULL
			ORDER BY s.sequence ASC, s.name ASC
		`
		args = append(args, *tableID)
	} else {
		query = `
			SELECT s.sys_id, s.table_id, COALESCE(o.name, ''), s.name, s.label, s.sequence, s.is_active, s.color, COALESCE(s.description, '')
			FROM sys_state s
			LEFT JOIN sys_db_object o ON o.sys_id = s.table_id
			ORDER BY s.sequence ASC, s.name ASC
		`
	}

	rows, err := e.db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var states []StateItem
	for rows.Next() {
		var item StateItem
		if err := rows.Scan(
			&item.SysID, &item.TableID, &item.TableName,
			&item.Name, &item.Label, &item.Sequence,
			&item.IsActive, &item.Color, &item.Description,
		); err != nil {
			return nil, err
		}
		states = append(states, item)
	}
	return states, nil
}

// GetState retrieves a state by its sys_id.
func (e *Engine) GetState(ctx context.Context, id uuid.UUID) (*StateItem, error) {
	var item StateItem
	err := e.db.Pool.QueryRow(ctx, `
		SELECT s.sys_id, s.table_id, COALESCE(o.name, ''), s.name, s.label, s.sequence, s.is_active, s.color, COALESCE(s.description, '')
		FROM sys_state s
		LEFT JOIN sys_db_object o ON o.sys_id = s.table_id
		WHERE s.sys_id = $1
	`, id).Scan(
		&item.SysID, &item.TableID, &item.TableName,
		&item.Name, &item.Label, &item.Sequence,
		&item.IsActive, &item.Color, &item.Description,
	)
	if err != nil {
		return nil, fmt.Errorf("estado não encontrado: %w", err)
	}
	return &item, nil
}

// CreateState creates a new status in sys_state.
func (e *Engine) CreateState(ctx context.Context, item StateItem, userCtx *auth.SecurityContext) (*StateItem, error) {
	if strings.TrimSpace(item.Name) == "" {
		return nil, errors.New("o identificador (name) do estado é obrigatório")
	}
	if strings.TrimSpace(item.Label) == "" {
		item.Label = item.Name
	}
	if strings.TrimSpace(item.Color) == "" {
		item.Color = "gray"
	}

	var newID uuid.UUID
	err := auth.ExecuteInTx(ctx, e.db, userCtx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO sys_state (table_id, name, label, sequence, is_active, color, description, sys_created_by, sys_updated_by)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
			RETURNING sys_id
		`, item.TableID, strings.TrimSpace(item.Name), strings.TrimSpace(item.Label), item.Sequence, item.IsActive, item.Color, item.Description, userCtx.UserID).Scan(&newID)
	})
	if err != nil {
		return nil, err
	}
	return e.GetState(ctx, newID)
}

// UpdateState updates a state in sys_state.
func (e *Engine) UpdateState(ctx context.Context, id uuid.UUID, item StateItem, userCtx *auth.SecurityContext) (*StateItem, error) {
	err := auth.ExecuteInTx(ctx, e.db, userCtx, func(tx pgx.Tx) error {
		cmd, err := tx.Exec(ctx, `
			UPDATE sys_state
			SET label = $1, sequence = $2, is_active = $3, color = $4, description = $5,
			    sys_updated_on = clock_timestamp(), sys_updated_by = $6, sys_mod_count = sys_mod_count + 1
			WHERE sys_id = $7
		`, item.Label, item.Sequence, item.IsActive, item.Color, item.Description, userCtx.UserID, id)
		if err != nil {
			return err
		}
		if cmd.RowsAffected() == 0 {
			return errors.New("estado não encontrado para atualização")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return e.GetState(ctx, id)
}

// DeleteState removes a state from sys_state.
func (e *Engine) DeleteState(ctx context.Context, id uuid.UUID, userCtx *auth.SecurityContext) error {
	return auth.ExecuteInTx(ctx, e.db, userCtx, func(tx pgx.Tx) error {
		cmd, err := tx.Exec(ctx, "DELETE FROM sys_state WHERE sys_id = $1", id)
		if err != nil {
			return err
		}
		if cmd.RowsAffected() == 0 {
			return errors.New("estado não encontrado para exclusão")
		}
		return nil
	})
}

// ResolveState resolves a state by either UUID or name string, respecting table lineage if provided.
func (e *Engine) ResolveState(ctx context.Context, val interface{}, tableID *uuid.UUID) (*StateItem, error) {
	if val == nil {
		return nil, errors.New("valor de estado nulo")
	}

	valStr := fmt.Sprintf("%v", val)
	valStr = strings.TrimSpace(valStr)
	if valStr == "" {
		return nil, errors.New("valor de estado vazio")
	}

	// 1. Try parsing as UUID
	if uid, err := uuid.Parse(valStr); err == nil {
		state, err := e.GetState(ctx, uid)
		if err == nil {
			return state, nil
		}
	}

	// 2. Lookup by name
	var item StateItem
	var query string
	var args []interface{}

	if tableID != nil && *tableID != uuid.Nil {
		query = `
			SELECT s.sys_id, s.table_id, COALESCE(o.name, ''), s.name, s.label, s.sequence, s.is_active, s.color, COALESCE(s.description, '')
			FROM sys_state s
			LEFT JOIN sys_db_object o ON o.sys_id = s.table_id
			WHERE LOWER(s.name) = LOWER($1) AND (s.table_id = $2 OR s.table_id IS NULL)
			ORDER BY (s.table_id IS NOT NULL) DESC
			LIMIT 1
		`
		args = []interface{}{valStr, *tableID}
	} else {
		query = `
			SELECT s.sys_id, s.table_id, COALESCE(o.name, ''), s.name, s.label, s.sequence, s.is_active, s.color, COALESCE(s.description, '')
			FROM sys_state s
			LEFT JOIN sys_db_object o ON o.sys_id = s.table_id
			WHERE LOWER(s.name) = LOWER($1)
			ORDER BY (s.table_id IS NOT NULL) DESC
			LIMIT 1
		`
		args = []interface{}{valStr}
	}

	err := e.db.Pool.QueryRow(ctx, query, args...).Scan(
		&item.SysID, &item.TableID, &item.TableName,
		&item.Name, &item.Label, &item.Sequence,
		&item.IsActive, &item.Color, &item.Description,
	)
	if err != nil {
		return nil, fmt.Errorf("estado '%s' não encontrado em sys_state", valStr)
	}

	return &item, nil
}

// GetStateReferenceColumns finds all columns in the table lineage that are references to sys_state.
func (e *Engine) GetStateReferenceColumns(ctx context.Context, tableID uuid.UUID) ([]string, error) {
	cte := `
		WITH RECURSIVE lineage AS (
			SELECT sys_id, super_class_id FROM sys_db_object WHERE sys_id = $1
			UNION ALL
			SELECT p.sys_id, p.super_class_id FROM sys_db_object p
			JOIN lineage l ON l.super_class_id = p.sys_id
		)
		SELECT DISTINCT d.column_name
		FROM sys_dictionary d
		JOIN sys_db_object ro ON ro.sys_id = d.reference_table_id
		WHERE d.table_id IN (SELECT sys_id FROM lineage)
		  AND d.internal_type = 'reference'
		  AND ro.name = 'sys_state';
	`
	rows, err := e.db.Pool.Query(ctx, cte, tableID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var cols []string
	for rows.Next() {
		var col string
		if err := rows.Scan(&col); err == nil {
			cols = append(cols, col)
		}
	}
	return cols, nil
}

// GetAvailableTransitions retrieves transitions that the user is authorized to execute on the current record.
func (e *Engine) GetAvailableTransitions(ctx context.Context, tableName string, record map[string]interface{}, userCtx *auth.SecurityContext) ([]TransitionInfo, error) {
	var tableID uuid.UUID
	_ = e.db.Pool.QueryRow(ctx, "SELECT sys_id FROM sys_db_object WHERE name = $1", tableName).Scan(&tableID)

	// Identify state field: check reference columns or default to 'state'
	stateField := "state"
	refCols, _ := e.GetStateReferenceColumns(ctx, tableID)
	if len(refCols) > 0 {
		stateField = refCols[0]
	}

	// Current state resolution
	currentVal := record[stateField]
	if currentVal == nil || currentVal == "" {
		currentVal = "new"
	}

	resolvedState, err := e.ResolveState(ctx, currentVal, &tableID)
	var currentUID uuid.UUID
	var currentName string
	if err == nil && resolvedState != nil {
		currentUID = resolvedState.SysID
		currentName = resolvedState.Name
	} else {
		currentName = fmt.Sprintf("%v", currentVal)
	}

	transitions, err := e.resolvePolymorphicTransitions(ctx, tableName, stateField)
	if err != nil {
		return nil, err
	}

	available := make([]TransitionInfo, 0)
	for _, t := range transitions {
		// 1. Must match current state (by UUID or name)
		if t.FromStateID != uuid.Nil && currentUID != uuid.Nil {
			if t.FromStateID != currentUID {
				continue
			}
		} else if !strings.EqualFold(t.FromState, currentName) {
			continue
		}

		// 2. Check role requirement
		if t.RequiredRoleID != nil && !userCtx.HasRole("admin") {
			hasRole := false
			for _, rid := range userCtx.RoleIDs {
				if rid == *t.RequiredRoleID {
					hasRole = true
					break
				}
			}
			if !hasRole {
				continue
			}
		}

		// 3. Check execute permission
		actionName := t.ActionName
		hasPerm, err := e.authService.HasPermission(ctx, userCtx, tableID, "execute", nil, &actionName)
		if err != nil || !hasPerm {
			if !userCtx.HasRole("admin") {
				continue
			}
		}

		// 4. Check condition tree against current record state
		if len(t.ConditionTreeJSON) > 0 {
			tree, err := condition.ParseConditionTree(t.ConditionTreeJSON)
			if err == nil && tree != nil {
				enriched := make(map[string]interface{})
				for k, v := range record {
					enriched[k] = v
				}
				if resolvedState != nil {
					enriched[stateField] = resolvedState.Name
					enriched[stateField+"_id"] = resolvedState.SysID.String()
					enriched[stateField+"_label"] = resolvedState.Label
				}
				if !condition.EvaluateCondition(tree, enriched, nil, userCtx) {
					continue
				}
			}
		}

		available = append(available, t)
	}

	return available, nil
}

// ValidateAndApplyTransition checks all guards and returns mutated record attributes.
func (e *Engine) ValidateAndApplyTransition(
	ctx context.Context,
	tx pgx.Tx,
	tableName string,
	currentRecord map[string]interface{},
	transitionID uuid.UUID,
	proposedPayload map[string]interface{},
	userCtx *auth.SecurityContext,
) (string, map[string]interface{}, error) {
	var (
		fromStateID        uuid.UUID
		fromStateName      string
		fromStateLabel     string
		toStateID          uuid.UUID
		toStateName        string
		toStateLabel       string
		stateField         string
		requiredRoleID     *uuid.UUID
		conditionTreeData  []byte
		onTransitionAction []byte
	)

	err := tx.QueryRow(ctx, `
		SELECT st.from_state_id, COALESCE(fs.name, st.from_state, ''), COALESCE(fs.label, st.from_state, ''),
		       st.to_state_id, COALESCE(ts.name, st.to_state, ''), COALESCE(ts.label, st.to_state, ''),
		       st.state_field, st.required_role_id, st.condition_tree, st.on_transition_action
		FROM sys_state_transition st
		LEFT JOIN sys_state fs ON fs.sys_id = st.from_state_id
		LEFT JOIN sys_state ts ON ts.sys_id = st.to_state_id
		WHERE st.sys_id = $1 AND st.is_active = TRUE
	`, transitionID).Scan(
		&fromStateID, &fromStateName, &fromStateLabel,
		&toStateID, &toStateName, &toStateLabel,
		&stateField, &requiredRoleID, &conditionTreeData, &onTransitionAction,
	)
	if err != nil {
		return "", nil, errors.New("transição de estado não encontrada ou inativa")
	}

	if stateField == "" {
		stateField = "state"
	}

	// Validate current record matches from_state
	currentVal := currentRecord[stateField]
	var currentUID uuid.UUID
	if currentVal != nil {
		if uid, err := uuid.Parse(fmt.Sprintf("%v", currentVal)); err == nil {
			currentUID = uid
		}
	}

	if currentUID != uuid.Nil && fromStateID != uuid.Nil {
		if currentUID != fromStateID {
			return "", nil, fmt.Errorf("transição inválida: o registro está em '%s', mas a ação requer '%s'", currentVal, fromStateLabel)
		}
	} else {
		currStr := fmt.Sprintf("%v", currentVal)
		if !strings.EqualFold(currStr, fromStateName) && !strings.EqualFold(currStr, fromStateID.String()) {
			return "", nil, fmt.Errorf("transição inválida: o registro está no estado '%s', mas a ação requer '%s'", currStr, fromStateLabel)
		}
	}

	// Validate role
	if requiredRoleID != nil && !userCtx.HasRole("admin") {
		hasRole := false
		for _, rid := range userCtx.RoleIDs {
			if rid == *requiredRoleID {
				hasRole = true
				break
			}
		}
		if !hasRole {
			return "", nil, errors.New("permissão insuficiente: papel (role) obrigatório para esta transição não atribuído")
		}
	}

	// Merge current + proposed to evaluate condition tree
	merged := make(map[string]interface{})
	for k, v := range currentRecord {
		merged[k] = v
	}
	for k, v := range proposedPayload {
		merged[k] = v
	}
	merged[stateField] = toStateID.String()
	merged[stateField+"_name"] = toStateName
	merged[stateField+"_label"] = toStateLabel

	// Evaluate condition tree
	if len(conditionTreeData) > 0 {
		tree, err := condition.ParseConditionTree(conditionTreeData)
		if err == nil && tree != nil {
			if !condition.EvaluateCondition(tree, merged, currentRecord, userCtx) {
				return "", nil, errors.New("condições obrigatórias para a transição de estado não atendidas")
			}
		}
	}

	// Apply mutations
	mutations := make(map[string]interface{})
	for k, v := range proposedPayload {
		mutations[k] = v
	}
	// The state column in DB is a reference to sys_state: store the UUID!
	mutations[stateField] = toStateID.String()

	if len(onTransitionAction) > 0 {
		var actionDef struct {
			SetFields map[string]interface{} `json:"set_fields"`
		}
		if err := json.Unmarshal(onTransitionAction, &actionDef); err == nil {
			nowStr := time.Now().UTC().Format(time.RFC3339)
			for k, v := range actionDef.SetFields {
				valStr := fmt.Sprintf("%v", v)
				if valStr == "$NOW" {
					mutations[k] = nowStr
				} else if valStr == "$CURRENT_USER" {
					mutations[k] = userCtx.UserID.String()
				} else {
					mutations[k] = v
				}
			}
		}
	}

	return toStateID.String(), mutations, nil
}

func (e *Engine) resolvePolymorphicTransitions(ctx context.Context, tableName, stateField string) ([]TransitionInfo, error) {
	cte := `
		WITH RECURSIVE table_lineage AS (
			SELECT sys_id, name, super_class_id, 0 AS depth
			FROM sys_db_object
			WHERE name = $1

			UNION ALL

			SELECT parent.sys_id, parent.name, parent.super_class_id, tl.depth + 1
			FROM sys_db_object parent
			JOIN table_lineage tl ON tl.super_class_id = parent.sys_id
		)
		SELECT DISTINCT ON (st.from_state_id, st.to_state_id)
			st.sys_id,
			st.from_state_id,
			COALESCE(fs.name, st.from_state, '') AS from_state_name,
			COALESCE(fs.label, st.from_state, '') AS from_state_label,
			st.to_state_id,
			COALESCE(ts.name, st.to_state, '') AS to_state_name,
			COALESCE(ts.label, st.to_state, '') AS to_state_label,
			st.label,
			st.required_role_id,
			st.condition_tree,
			st.on_transition_action,
			tl.name AS defined_in_table
		FROM table_lineage tl
		JOIN sys_state_transition st ON st.table_id = tl.sys_id
		LEFT JOIN sys_state fs ON fs.sys_id = st.from_state_id
		LEFT JOIN sys_state ts ON ts.sys_id = st.to_state_id
		WHERE st.state_field = $2 AND st.is_active = TRUE
		ORDER BY st.from_state_id, st.to_state_id, tl.depth ASC;
	`

	rows, err := e.db.Pool.Query(ctx, cte, tableName, stateField)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []TransitionInfo
	for rows.Next() {
		var t TransitionInfo
		if err := rows.Scan(
			&t.TransitionID,
			&t.FromStateID, &t.FromState, &t.FromStateLabel,
			&t.ToStateID, &t.ToState, &t.ToStateLabel,
			&t.Label, &t.RequiredRoleID,
			&t.ConditionTreeJSON, &t.OnTransitionAction,
			&t.DefinedInTable,
		); err != nil {
			return nil, err
		}
		t.ActionName = fmt.Sprintf("transition:%s:%s", t.FromState, t.ToState)
		result = append(result, t)
	}

	return result, nil
}
