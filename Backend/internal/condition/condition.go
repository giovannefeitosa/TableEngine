package condition

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"time"

	"tableengine/internal/auth"
)

type ConditionNode struct {
	// If Operator is "AND" or "OR", Rules will contain children
	Operator string          `json:"operator"` // AND, OR, or leaf comparison operator
	Rules    []ConditionNode `json:"rules,omitempty"`

	// Leaf properties
	Field string      `json:"field,omitempty"`
	Value interface{} `json:"value,omitempty"`
}

type ConditionTree = ConditionNode

// ParseConditionTree parses a JSON or JSONB payload into a ConditionTree.
func ParseConditionTree(data []byte) (*ConditionTree, error) {
	if len(data) == 0 || string(data) == "null" || string(data) == "{}" {
		return nil, nil
	}
	var tree ConditionTree
	if err := json.Unmarshal(data, &tree); err != nil {
		return nil, err
	}
	return &tree, nil
}

// EvaluateCondition evaluates the condition AST against current and previous record state.
func EvaluateCondition(tree *ConditionTree, current, previous map[string]interface{}, ctx *auth.SecurityContext) bool {
	if tree == nil {
		return true
	}

	op := strings.ToUpper(strings.TrimSpace(tree.Operator))
	if op == "" && len(tree.Rules) == 0 {
		return true
	}

	if op == "AND" {
		for _, rule := range tree.Rules {
			if !EvaluateCondition(&rule, current, previous, ctx) {
				return false
			}
		}
		return true
	} else if op == "OR" {
		if len(tree.Rules) == 0 {
			return true
		}
		for _, rule := range tree.Rules {
			if EvaluateCondition(&rule, current, previous, ctx) {
				return true
			}
		}
		return false
	}

	// Leaf node evaluation
	return evaluateLeafRule(tree, current, previous, ctx)
}

func evaluateLeafRule(node *ConditionNode, current, previous map[string]interface{}, ctx *auth.SecurityContext) bool {
	fieldName := node.Field
	op := strings.ToUpper(strings.TrimSpace(node.Operator))

	var currentVal interface{}
	if current != nil {
		currentVal = current[fieldName]
	}

	var previousVal interface{}
	if previous != nil {
		previousVal = previous[fieldName]
	}

	targetValue := resolveContextVariables(node.Value, ctx)

	switch op {
	case "EQUALS":
		return compareValuesEqual(currentVal, targetValue)

	case "NOT_EQUALS":
		return !compareValuesEqual(currentVal, targetValue)

	case "GREATER_THAN":
		cmp, ok := compareNumeric(currentVal, targetValue)
		return ok && cmp > 0

	case "LESS_THAN":
		cmp, ok := compareNumeric(currentVal, targetValue)
		return ok && cmp < 0

	case "GREATER_THAN_OR_EQUAL":
		cmp, ok := compareNumeric(currentVal, targetValue)
		return ok && cmp >= 0

	case "LESS_THAN_OR_EQUAL":
		cmp, ok := compareNumeric(currentVal, targetValue)
		return ok && cmp <= 0

	case "IS_EMPTY":
		return isEmpty(currentVal)

	case "IS_NOT_EMPTY":
		return !isEmpty(currentVal)

	case "CONTAINS":
		s1 := fmt.Sprintf("%v", currentVal)
		s2 := fmt.Sprintf("%v", targetValue)
		return strings.Contains(strings.ToLower(s1), strings.ToLower(s2))

	case "NOT_CONTAINS":
		s1 := fmt.Sprintf("%v", currentVal)
		s2 := fmt.Sprintf("%v", targetValue)
		return !strings.Contains(strings.ToLower(s1), strings.ToLower(s2))

	case "STARTS_WITH":
		s1 := fmt.Sprintf("%v", currentVal)
		s2 := fmt.Sprintf("%v", targetValue)
		return strings.HasPrefix(strings.ToLower(s1), strings.ToLower(s2))

	case "ENDS_WITH":
		s1 := fmt.Sprintf("%v", currentVal)
		s2 := fmt.Sprintf("%v", targetValue)
		return strings.HasSuffix(strings.ToLower(s1), strings.ToLower(s2))

	case "IN":
		return isInList(currentVal, targetValue)

	case "NOT_IN":
		return !isInList(currentVal, targetValue)

	case "IS_TRUE":
		return isTrue(currentVal)

	case "IS_FALSE":
		return isFalse(currentVal)

	case "CHANGES":
		return !compareValuesEqual(currentVal, previousVal)

	case "CHANGES_TO":
		return compareValuesEqual(currentVal, targetValue) && !compareValuesEqual(previousVal, targetValue)

	case "CHANGES_FROM":
		return compareValuesEqual(previousVal, targetValue) && !compareValuesEqual(currentVal, targetValue)

	default:
		return true
	}
}

func resolveContextVariables(val interface{}, ctx *auth.SecurityContext) interface{} {
	if s, ok := val.(string); ok {
		switch s {
		case "@current_user.sys_id":
			if ctx != nil {
				return ctx.UserID.String()
			}
			return ""
		case "@current_user.groups":
			if ctx != nil {
				groups := make([]string, len(ctx.Groups))
				for i, g := range ctx.Groups {
					groups[i] = g.String()
				}
				return groups
			}
			return []string{}
		case "@now":
			return time.Now().UTC().Format(time.RFC3339)
		}
	}
	return val
}

func compareValuesEqual(v1, v2 interface{}) bool {
	if v1 == nil && v2 == nil {
		return true
	}
	if v1 == nil || v2 == nil {
		return false
	}

	// Try numeric comparison
	if n1, ok1 := toFloat(v1); ok1 {
		if n2, ok2 := toFloat(v2); ok2 {
			return n1 == n2
		}
	}

	s1 := strings.TrimSpace(fmt.Sprintf("%v", v1))
	s2 := strings.TrimSpace(fmt.Sprintf("%v", v2))
	return strings.EqualFold(s1, s2)
}

func compareNumeric(v1, v2 interface{}) (int, bool) {
	n1, ok1 := toFloat(v1)
	n2, ok2 := toFloat(v2)
	if !ok1 || !ok2 {
		return 0, false
	}
	if n1 > n2 {
		return 1, true
	} else if n1 < n2 {
		return -1, true
	}
	return 0, true
}

func toFloat(v interface{}) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case int32:
		return float64(n), true
	case string:
		var f float64
		if _, err := fmt.Sscanf(n, "%f", &f); err == nil {
			return f, true
		}
	}
	return 0, false
}

func isEmpty(v interface{}) bool {
	if v == nil {
		return true
	}
	val := reflect.ValueOf(v)
	switch val.Kind() {
	case reflect.String:
		return strings.TrimSpace(val.String()) == ""
	case reflect.Array, reflect.Slice, reflect.Map:
		return val.Len() == 0
	}
	return false
}

func isInList(item, list interface{}) bool {
	if list == nil {
		return false
	}
	itemStr := strings.TrimSpace(fmt.Sprintf("%v", item))

	val := reflect.ValueOf(list)
	if val.Kind() == reflect.Slice || val.Kind() == reflect.Array {
		for i := 0; i < val.Len(); i++ {
			elemStr := strings.TrimSpace(fmt.Sprintf("%v", val.Index(i).Interface()))
			if strings.EqualFold(itemStr, elemStr) {
				return true
			}
		}
	}
	return false
}

func isTrue(v interface{}) bool {
	if v == nil {
		return false
	}
	if b, ok := v.(bool); ok {
		return b
	}
	s := strings.ToLower(fmt.Sprintf("%v", v))
	return s == "true" || s == "1" || s == "t"
}

func isFalse(v interface{}) bool {
	if v == nil {
		return false
	}
	if b, ok := v.(bool); ok {
		return !b
	}
	s := strings.ToLower(fmt.Sprintf("%v", v))
	return s == "false" || s == "0" || s == "f"
}
