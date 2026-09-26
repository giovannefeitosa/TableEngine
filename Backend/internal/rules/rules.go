package rules

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/dop251/goja"
	"github.com/google/uuid"

	"tableengine/internal/auth"
	"tableengine/internal/condition"
	"tableengine/internal/database"
)

type ScriptRule struct {
	SysID               uuid.UUID `json:"sys_id"`
	Name                string    `json:"name"`
	Timing              string    `json:"timing"`
	ExecutionOrder      int       `json:"execution_order"`
	ExecutionMode       string    `json:"execution_mode"`
	RunAsUserID         *uuid.UUID `json:"run_as_user_id"`
	ConditionExpression []byte    `json:"condition_expression"`
	ActionType          string    `json:"action_type"`
	ActionPayload       []byte    `json:"action_payload"`
}

type AbortError struct {
	Message    string
	StatusCode int
}

func (e *AbortError) Error() string {
	return e.Message
}

type Engine struct {
	db *database.DB
}

func NewEngine(db *database.DB) *Engine {
	return &Engine{db: db}
}

// ExecuteRules finds and runs matching business rules for the given timing and table.
func (e *Engine) ExecuteRules(
	ctx context.Context,
	timing string,
	tableName string,
	current, previous map[string]interface{},
	userCtx *auth.SecurityContext,
) error {
	cte := `
		WITH RECURSIVE table_lineage AS (
			SELECT sys_id, name, super_class_id, 0 AS inheritance_level
			FROM sys_db_object
			WHERE name = $1

			UNION ALL

			SELECT parent.sys_id, parent.name, parent.super_class_id, tl.inheritance_level + 1
			FROM sys_db_object parent
			JOIN table_lineage tl ON tl.super_class_id = parent.sys_id
		)
		SELECT
			s.sys_id, s.name, s.timing, s.execution_order, s.execution_mode,
			s.run_as_user_id, s.condition_expression, s.action_type, s.action_payload
		FROM table_lineage tl
		JOIN sys_script s ON s.table_id = tl.sys_id
		WHERE s.timing = $2 AND s.is_active = TRUE
		ORDER BY tl.inheritance_level DESC, s.execution_order ASC;
	`

	rows, err := e.db.Pool.Query(ctx, cte, tableName, timing)
	if err != nil {
		return err
	}
	defer rows.Close()

	var rules []ScriptRule
	for rows.Next() {
		var r ScriptRule
		if err := rows.Scan(
			&r.SysID, &r.Name, &r.Timing, &r.ExecutionOrder, &r.ExecutionMode,
			&r.RunAsUserID, &r.ConditionExpression, &r.ActionType, &r.ActionPayload,
		); err != nil {
			return err
		}
		rules = append(rules, r)
	}

	for _, rule := range rules {
		// Evaluate condition
		if len(rule.ConditionExpression) > 0 {
			tree, err := condition.ParseConditionTree(rule.ConditionExpression)
			if err != nil || tree == nil {
				continue
			}
			if !condition.EvaluateCondition(tree, current, previous, userCtx) {
				continue
			}
		}

		// Execute action
		if err := e.executeAction(rule, current, previous, userCtx); err != nil {
			return err
		}
	}

	return nil
}

func (e *Engine) executeAction(rule ScriptRule, current, previous map[string]interface{}, userCtx *auth.SecurityContext) error {
	switch rule.ActionType {
	case "abort_transaction":
		var payload struct {
			Message    string `json:"message"`
			StatusCode int    `json:"status_code"`
		}
		_ = json.Unmarshal(rule.ActionPayload, &payload)
		msg := payload.Message
		if msg == "" {
			msg = fmt.Sprintf("Operação bloqueada pela regra de negócio: %s", rule.Name)
		}
		code := payload.StatusCode
		if code == 0 {
			code = 422
		}
		return &AbortError{Message: msg, StatusCode: code}

	case "set_field_value":
		var payload struct {
			Field    string      `json:"field"`
			Value    interface{} `json:"value"`
			Template string      `json:"template"`
		}
		if err := json.Unmarshal(rule.ActionPayload, &payload); err == nil && payload.Field != "" {
			if payload.Template != "" {
				res := payload.Template
				for k, v := range current {
					placeholder := fmt.Sprintf("{{%s}}", k)
					res = strings.ReplaceAll(res, placeholder, fmt.Sprintf("%v", v))
				}
				current[payload.Field] = res
			} else {
				current[payload.Field] = payload.Value
			}
		}

	case "execute_script":
		var payload struct {
			Script string `json:"script"`
		}
		if err := json.Unmarshal(rule.ActionPayload, &payload); err == nil && payload.Script != "" {
			return runSandboxedScript(payload.Script, current, previous, userCtx)
		}
	}

	return nil
}

func runSandboxedScript(script string, current, previous map[string]interface{}, userCtx *auth.SecurityContext) error {
	vm := goja.New()

	// Set execution timeout
	timeLimit := 500 * time.Millisecond
	timer := time.AfterFunc(timeLimit, func() {
		vm.Interrupt("Script execution timed out (limit: 500ms)")
	})
	defer timer.Stop()

	// Expose current, previous, user
	_ = vm.Set("current", current)
	_ = vm.Set("previous", previous)

	userObj := map[string]interface{}{}
	if userCtx != nil {
		userObj["sys_id"] = userCtx.UserID.String()
		userObj["user_name"] = userCtx.UserName
		userObj["roles"] = userCtx.RoleNames
	}
	_ = vm.Set("user", userObj)

	_, err := vm.RunString(script)
	if err != nil {
		return fmt.Errorf("erro na execução de script de regra de negócio: %w", err)
	}

	// Pull back mutations to current
	currVal := vm.Get("current")
	if currVal != nil {
		if m, ok := currVal.Export().(map[string]interface{}); ok {
			for k, v := range m {
				current[k] = v
			}
		}
	}

	return nil
}
