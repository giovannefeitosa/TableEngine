package condition

import (
	"testing"

	"github.com/google/uuid"

	"tableengine/internal/auth"
)

func TestEvaluateCondition_SimpleEquals(t *testing.T) {
	node := &ConditionNode{
		Field:    "severity",
		Operator: "EQUALS",
		Value:    1,
	}

	record := map[string]interface{}{
		"severity": 1,
	}

	if !EvaluateCondition(node, record, nil, nil) {
		t.Errorf("Expected condition to evaluate to true for severity=1")
	}

	record["severity"] = 2
	if EvaluateCondition(node, record, nil, nil) {
		t.Errorf("Expected condition to evaluate to false for severity=2")
	}
}

func TestEvaluateCondition_AndOrSubtrees(t *testing.T) {
	tree := &ConditionNode{
		Operator: "AND",
		Rules: []ConditionNode{
			{
				Field:    "state",
				Operator: "EQUALS",
				Value:    "in_progress",
			},
			{
				Operator: "OR",
				Rules: []ConditionNode{
					{
						Field:    "severity",
						Operator: "LESS_THAN_OR_EQUAL",
						Value:    2,
					},
					{
						Field:    "short_description",
						Operator: "CONTAINS",
						Value:    "URGENT",
					},
				},
			},
		},
	}

	rec1 := map[string]interface{}{
		"state":             "in_progress",
		"severity":          2,
		"short_description": "Normal task",
	}
	if !EvaluateCondition(tree, rec1, nil, nil) {
		t.Errorf("Expected rec1 to match condition")
	}

	rec2 := map[string]interface{}{
		"state":             "in_progress",
		"severity":          4,
		"short_description": "Normal task",
	}
	if EvaluateCondition(tree, rec2, nil, nil) {
		t.Errorf("Expected rec2 to NOT match condition")
	}
}

func TestEvaluateCondition_ContextVariables(t *testing.T) {
	userUUID := uuid.MustParse("00000000-0000-4000-8000-000000000003")
	userCtx := &auth.SecurityContext{
		UserID:   userUUID,
		UserName: "analyst",
	}

	node := &ConditionNode{
		Field:    "caller_id",
		Operator: "EQUALS",
		Value:    "@current_user.sys_id",
	}

	rec := map[string]interface{}{
		"caller_id": userUUID.String(),
	}

	if !EvaluateCondition(node, rec, nil, userCtx) {
		t.Errorf("Expected condition with context variable @current_user.sys_id to match")
	}
}
