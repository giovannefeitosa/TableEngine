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

type TransitionInfo struct {
	TransitionID       uuid.UUID  `json:"transition_id"`
	FromState          string     `json:"from_state"`
	ToState            string     `json:"to_state"`
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

// GetAvailableTransitions retrieves transitions that the user is authorized to execute on the current record.
func (e *Engine) GetAvailableTransitions(ctx context.Context, tableName string, record map[string]interface{}, userCtx *auth.SecurityContext) ([]TransitionInfo, error) {
	currentState, ok := record["state"].(string)
	if !ok || currentState == "" {
		currentState = "draft"
	}

	transitions, err := e.resolvePolymorphicTransitions(ctx, tableName, "state")
	if err != nil {
		return nil, err
	}

	var tableID uuid.UUID
	_ = e.db.Pool.QueryRow(ctx, "SELECT sys_id FROM sys_db_object WHERE name = $1", tableName).Scan(&tableID)

	available := make([]TransitionInfo, 0)
	for _, t := range transitions {
		// 1. Must match current state
		if !strings.EqualFold(t.FromState, currentState) {
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
			// If not admin and doesn't have explicit permission, continue
			if !userCtx.HasRole("admin") {
				continue
			}
		}

		// 4. Check condition tree against current record state
		if len(t.ConditionTreeJSON) > 0 {
			tree, err := condition.ParseConditionTree(t.ConditionTreeJSON)
			if err == nil && tree != nil {
				if !condition.EvaluateCondition(tree, record, nil, userCtx) {
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
	// Query the transition
	var (
		fromState          string
		toState            string
		requiredRoleID     *uuid.UUID
		conditionTreeData  []byte
		onTransitionAction []byte
	)

	err := tx.QueryRow(ctx, `
		SELECT from_state, to_state, required_role_id, condition_tree, on_transition_action
		FROM sys_state_transition
		WHERE sys_id = $1 AND is_active = TRUE
	`, transitionID).Scan(&fromState, &toState, &requiredRoleID, &conditionTreeData, &onTransitionAction)
	if err != nil {
		return "", nil, errors.New("transição de estado não encontrada ou inativa")
	}

	currentState := fmt.Sprintf("%v", currentRecord["state"])
	if !strings.EqualFold(currentState, fromState) {
		return "", nil, fmt.Errorf("transição inválida: o registro está no estado '%s', mas a ação requer '%s'", currentState, fromState)
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
	merged["state"] = toState

	// Evaluate condition tree
	if len(conditionTreeData) > 0 {
		tree, err := condition.ParseConditionTree(conditionTreeData)
		if err == nil && tree != nil {
			if !condition.EvaluateCondition(tree, merged, currentRecord, userCtx) {
				return "", nil, errors.New("condições obrigatórias para a transição de estado não atendidas")
			}
		}
	}

	// Apply on_transition_action
	mutations := make(map[string]interface{})
	for k, v := range proposedPayload {
		mutations[k] = v
	}
	mutations["state"] = toState

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

	return toState, mutations, nil
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
		SELECT DISTINCT ON (st.from_state, st.to_state)
			st.sys_id,
			st.from_state,
			st.to_state,
			st.label,
			st.required_role_id,
			st.condition_tree,
			st.on_transition_action,
			tl.name AS defined_in_table
		FROM table_lineage tl
		JOIN sys_state_transition st ON st.table_id = tl.sys_id
		WHERE st.state_field = $2 AND st.is_active = TRUE
		ORDER BY st.from_state, st.to_state, tl.depth ASC;
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
			&t.TransitionID, &t.FromState, &t.ToState, &t.Label,
			&t.RequiredRoleID, &t.ConditionTreeJSON, &t.OnTransitionAction,
			&t.DefinedInTable,
		); err != nil {
			return nil, err
		}
		t.ActionName = fmt.Sprintf("transition:%s:%s", t.FromState, t.ToState)
		result = append(result, t)
	}

	return result, nil
}
