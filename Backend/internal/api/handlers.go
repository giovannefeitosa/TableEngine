package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"tableengine/internal/audit"
	"tableengine/internal/auth"
	"tableengine/internal/condition"
	"tableengine/internal/crud"
	"tableengine/internal/database"
	"tableengine/internal/ddl"
	"tableengine/internal/fsm"
	"tableengine/internal/numbering"
	"tableengine/internal/rules"
)

type Handlers struct {
	db          *database.DB
	authService *auth.Service
	ddlEngine   *ddl.Engine
	numEngine   *numbering.Engine
	fsmEngine   *fsm.Engine
	rulesEngine *rules.Engine
	crudEngine  *crud.Engine
	auditEngine *audit.Engine
}

func NewHandlers(
	db *database.DB,
	authService *auth.Service,
	ddlEngine *ddl.Engine,
	numEngine *numbering.Engine,
	fsmEngine *fsm.Engine,
	rulesEngine *rules.Engine,
	crudEngine *crud.Engine,
	auditEngine *audit.Engine,
) *Handlers {
	return &Handlers{
		db:          db,
		authService: authService,
		ddlEngine:   ddlEngine,
		numEngine:   numEngine,
		fsmEngine:   fsmEngine,
		rulesEngine: rulesEngine,
		crudEngine:  crudEngine,
		auditEngine: auditEngine,
	}
}

// 1. Auth Handlers
func (h *Handlers) Login(w http.ResponseWriter, r *http.Request) {
	var req auth.LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Payload JSON inválido.")
		return
	}

	res, err := h.authService.Authenticate(r.Context(), req.UserName, req.Password)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "UNAUTHORIZED", err.Error())
		return
	}

	respondJSON(w, http.StatusOK, res)
}

func (h *Handlers) GetMe(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	if secCtx == nil {
		respondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Não autenticado.")
		return
	}

	user, err := h.authService.GetEffectiveUser(r.Context(), secCtx.UserID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	respondJSON(w, http.StatusOK, user)
}

// 2. Schema DDL Handlers
func (h *Handlers) ListTables(w http.ResponseWriter, r *http.Request) {
	includeKernel := r.URL.Query().Get("include_kernel") == "true"
	tables, err := h.ddlEngine.ListTables(r.Context(), includeKernel)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	respondJSON(w, http.StatusOK, tables)
}

func (h *Handlers) CreateTable(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	var req ddl.CreateTableRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Payload JSON inválido.")
		return
	}

	res, err := h.ddlEngine.CreateTable(r.Context(), req, secCtx)
	if err != nil {
		respondError(w, http.StatusBadRequest, "DDL_ERROR", err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, res)
}

func (h *Handlers) AddField(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	tableIDStr := chi.URLParam(r, "table_id")
	tableID, err := uuid.Parse(tableIDStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Identificador de tabela inválido.")
		return
	}

	var req ddl.AddFieldRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Payload JSON inválido.")
		return
	}

	field, err := h.ddlEngine.AddField(r.Context(), tableID, req, secCtx)
	if err != nil {
		respondError(w, http.StatusBadRequest, "DDL_ERROR", err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, field)
}

func (h *Handlers) GetTableFields(w http.ResponseWriter, r *http.Request) {
	tableName := chi.URLParam(r, "table_name")
	fields, err := h.ddlEngine.ResolveFields(r.Context(), tableName)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	respondJSON(w, http.StatusOK, fields)
}

func (h *Handlers) AddChoice(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	var req struct {
		TableID        uuid.UUID `json:"table_id"`
		Element        string    `json:"element"`
		Value          string    `json:"value"`
		Label          string    `json:"label"`
		Sequence       int       `json:"sequence"`
		DependentValue *string   `json:"dependent_value"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Payload inválido.")
		return
	}

	var newID uuid.UUID
	err := auth.ExecuteInTx(r.Context(), h.db, secCtx, func(tx pgx.Tx) error {
		return tx.QueryRow(r.Context(), `
			INSERT INTO sys_choice (table_id, element, value, label, sequence, dependent_value)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING sys_id
		`, req.TableID, req.Element, req.Value, req.Label, req.Sequence, req.DependentValue).Scan(&newID)
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "CHOICE_ERROR", err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, map[string]interface{}{"sys_id": newID})
}

func (h *Handlers) GetChoices(w http.ResponseWriter, r *http.Request) {
	tableName := chi.URLParam(r, "table_name")
	element := chi.URLParam(r, "element")

	cte := `
		WITH RECURSIVE lineage AS (
			SELECT sys_id, name, super_class_id, 0 AS depth
			FROM sys_db_object WHERE name = $1
			UNION ALL
			SELECT p.sys_id, p.name, p.super_class_id, l.depth + 1
			FROM sys_db_object p
			JOIN lineage l ON l.super_class_id = p.sys_id
		)
		SELECT c.sys_id, c.element, c.value, c.label, c.sequence
		FROM lineage l
		JOIN sys_choice c ON c.table_id = l.sys_id
		WHERE c.element = $2 AND c.is_active = TRUE
		ORDER BY c.sequence ASC, c.label ASC;
	`
	rows, err := h.db.Pool.Query(r.Context(), cte, tableName, element)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	defer rows.Close()

	type ChoiceInfo struct {
		SysID    uuid.UUID `json:"sys_id"`
		Element  string    `json:"element"`
		Value    string    `json:"value"`
		Label    string    `json:"label"`
		Sequence int       `json:"sequence"`
	}
	choices := make([]ChoiceInfo, 0)
	for rows.Next() {
		var c ChoiceInfo
		if err := rows.Scan(&c.SysID, &c.Element, &c.Value, &c.Label, &c.Sequence); err == nil {
			choices = append(choices, c)
		}
	}

	respondJSON(w, http.StatusOK, choices)
}

func (h *Handlers) GetTableChoices(w http.ResponseWriter, r *http.Request) {
	tableName := chi.URLParam(r, "table_name")

	cte := `
		WITH RECURSIVE lineage AS (
			SELECT sys_id, name, super_class_id, 0 AS depth
			FROM sys_db_object WHERE name = $1
			UNION ALL
			SELECT p.sys_id, p.name, p.super_class_id, l.depth + 1
			FROM sys_db_object p
			JOIN lineage l ON l.super_class_id = p.sys_id
		)
		SELECT c.sys_id, c.element, c.value, c.label, c.sequence
		FROM lineage l
		JOIN sys_choice c ON c.table_id = l.sys_id
		WHERE c.is_active = TRUE
		ORDER BY c.element ASC, c.sequence ASC, c.label ASC;
	`
	rows, err := h.db.Pool.Query(r.Context(), cte, tableName)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	defer rows.Close()

	type ChoiceInfo struct {
		SysID    uuid.UUID `json:"sys_id"`
		Element  string    `json:"element"`
		Value    string    `json:"value"`
		Label    string    `json:"label"`
		Sequence int       `json:"sequence"`
	}
	choices := make([]ChoiceInfo, 0)
	for rows.Next() {
		var c ChoiceInfo
		if err := rows.Scan(&c.SysID, &c.Element, &c.Value, &c.Label, &c.Sequence); err == nil {
			choices = append(choices, c)
		}
	}

	respondJSON(w, http.StatusOK, choices)
}


func (h *Handlers) ConfigureNumber(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	var req numbering.ConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Payload inválido.")
		return
	}

	res, err := h.numEngine.ConfigureNumbering(r.Context(), req, secCtx)
	if err != nil {
		respondError(w, http.StatusBadRequest, "NUMBERING_ERROR", err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, res)
}

// 3. CRUD Polymorphic Records Handlers
func (h *Handlers) CreateRecord(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	tableName := chi.URLParam(r, "table")

	var payload map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Payload JSON inválido.")
		return
	}

	record, err := h.crudEngine.Create(r.Context(), tableName, payload, secCtx)
	if err != nil {
		var abortErr *rules.AbortError
		if errors.As(err, &abortErr) {
			respondError(w, abortErr.StatusCode, "BUSINESS_RULE_ABORT", abortErr.Message)
			return
		}
		respondError(w, http.StatusBadRequest, "CREATE_ERROR", err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, record)
}

func (h *Handlers) ReadRecords(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	tableName := chi.URLParam(r, "table")

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	sortBy := r.URL.Query().Get("sort_by")
	sortDir := r.URL.Query().Get("sort_dir")
	query := r.URL.Query().Get("query")

	res, err := h.crudEngine.ReadList(r.Context(), tableName, limit, offset, sortBy, sortDir, query, secCtx)
	if err != nil {
		respondError(w, http.StatusBadRequest, "QUERY_ERROR", err.Error())
		return
	}

	respondJSON(w, http.StatusOK, res)
}

func (h *Handlers) ReadSingleRecord(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	tableName := chi.URLParam(r, "table")
	sysIDStr := chi.URLParam(r, "sys_id")

	recordID, err := uuid.Parse(sysIDStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "sys_id inválido.")
		return
	}

	record, err := h.crudEngine.ReadSingle(r.Context(), tableName, recordID, secCtx)
	if err != nil {
		respondError(w, http.StatusNotFound, "NOT_FOUND", err.Error())
		return
	}

	respondJSON(w, http.StatusOK, record)
}

func (h *Handlers) UpdateRecord(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	tableName := chi.URLParam(r, "table")
	sysIDStr := chi.URLParam(r, "sys_id")

	recordID, err := uuid.Parse(sysIDStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "sys_id inválido.")
		return
	}

	var payload map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Payload JSON inválido.")
		return
	}

	record, err := h.crudEngine.Update(r.Context(), tableName, recordID, payload, secCtx)
	if err != nil {
		var conflictErr *crud.ConcurrencyConflictError
		if errors.As(err, &conflictErr) {
			respondError(w, http.StatusConflict, "CONCURRENCY_CONFLICT", conflictErr.Message)
			return
		}
		var abortErr *rules.AbortError
		if errors.As(err, &abortErr) {
			respondError(w, abortErr.StatusCode, "BUSINESS_RULE_ABORT", abortErr.Message)
			return
		}
		respondError(w, http.StatusBadRequest, "UPDATE_ERROR", err.Error())
		return
	}

	respondJSON(w, http.StatusOK, record)
}

func (h *Handlers) DeleteRecord(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	tableName := chi.URLParam(r, "table")
	sysIDStr := chi.URLParam(r, "sys_id")

	recordID, err := uuid.Parse(sysIDStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "sys_id inválido.")
		return
	}

	if err := h.crudEngine.Delete(r.Context(), tableName, recordID, secCtx); err != nil {
		respondError(w, http.StatusBadRequest, "DELETE_ERROR", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// 4. FSM State Transition Handlers
func (h *Handlers) GetAvailableTransitions(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	tableName := chi.URLParam(r, "table")
	sysIDStr := chi.URLParam(r, "sys_id")

	recordID, err := uuid.Parse(sysIDStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "sys_id inválido.")
		return
	}

	currentRecord, err := h.crudEngine.ReadSingle(r.Context(), tableName, recordID, secCtx)
	if err != nil {
		respondError(w, http.StatusNotFound, "NOT_FOUND", "Registro não encontrado.")
		return
	}

	transitions, err := h.fsmEngine.GetAvailableTransitions(r.Context(), tableName, currentRecord, secCtx)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	respondJSON(w, http.StatusOK, transitions)
}

func (h *Handlers) ExecuteTransition(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	tableName := chi.URLParam(r, "table")
	sysIDStr := chi.URLParam(r, "sys_id")
	transitionIDStr := chi.URLParam(r, "transition_id")

	recordID, err := uuid.Parse(sysIDStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "sys_id inválido.")
		return
	}
	transitionID, err := uuid.Parse(transitionIDStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "transition_id inválido.")
		return
	}

	var body struct {
		SysModCount interface{}            `json:"sys_mod_count"`
		Payload     map[string]interface{} `json:"payload"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Payload == nil {
		body.Payload = make(map[string]interface{})
	}
	if body.SysModCount != nil {
		body.Payload["sys_mod_count"] = body.SysModCount
	}

	updated, err := h.crudEngine.ExecuteStateTransition(r.Context(), tableName, recordID, transitionID, body.Payload, secCtx)
	if err != nil {
		if strings.Contains(err.Error(), "modificado por outro usuário") {
			respondError(w, http.StatusConflict, "CONCURRENCY_CONFLICT", err.Error())
			return
		}
		respondError(w, http.StatusUnprocessableEntity, "TRANSITION_FAILED", err.Error())
		return
	}

	respondJSON(w, http.StatusOK, updated)
}

// 5. Audit Handlers
func (h *Handlers) GetAuditHistory(w http.ResponseWriter, r *http.Request) {
	sysIDStr := chi.URLParam(r, "sys_id")
	docID, err := uuid.Parse(sysIDStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "sys_id inválido.")
		return
	}

	entries, err := h.auditEngine.GetAuditHistory(r.Context(), docID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	respondJSON(w, http.StatusOK, entries)
}

// 6. FSM & Rules Management Handlers
func (h *Handlers) CreateTransition(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	var req struct {
		TableID            uuid.UUID              `json:"table_id"`
		StateField         string                 `json:"state_field"`
		FromState          string                 `json:"from_state"`
		ToState            string                 `json:"to_state"`
		Label              string                 `json:"label"`
		RequiredRoleID     *uuid.UUID             `json:"required_role_id"`
		ConditionTree      map[string]interface{} `json:"condition_tree"`
		OnTransitionAction map[string]interface{} `json:"on_transition_action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Payload inválido.")
		return
	}
	if req.StateField == "" {
		req.StateField = "state"
	}

	condJSON, _ := json.Marshal(req.ConditionTree)
	actionJSON, _ := json.Marshal(req.OnTransitionAction)

	var newID uuid.UUID
	err := auth.ExecuteInTx(r.Context(), h.db, secCtx, func(tx pgx.Tx) error {
		return tx.QueryRow(r.Context(), `
			INSERT INTO sys_state_transition (
				table_id, state_field, from_state, to_state, label,
				required_role_id, condition_tree, on_transition_action
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			RETURNING sys_id
		`, req.TableID, req.StateField, req.FromState, req.ToState, req.Label, req.RequiredRoleID, condJSON, actionJSON).Scan(&newID)
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "TRANSITION_CREATE_ERROR", err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, map[string]interface{}{"sys_id": newID})
}

func (h *Handlers) ListTransitions(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Pool.Query(r.Context(), `
		SELECT st.sys_id, st.table_id, o.name AS table_name, st.from_state, st.to_state, st.label, st.is_active
		FROM sys_state_transition st
		JOIN sys_db_object o ON o.sys_id = st.table_id
		ORDER BY o.name ASC, st.from_state ASC
	`)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	defer rows.Close()

	list := make([]map[string]interface{}, 0)
	for rows.Next() {
		var sysID, tableID uuid.UUID
		var tableName, from, to, label string
		var active bool
		if err := rows.Scan(&sysID, &tableID, &tableName, &from, &to, &label, &active); err == nil {
			list = append(list, map[string]interface{}{
				"sys_id":     sysID,
				"table_id":   tableID,
				"table_name": tableName,
				"from_state": from,
				"to_state":   to,
				"label":      label,
				"is_active":  active,
			})
		}
	}

	respondJSON(w, http.StatusOK, list)
}

func (h *Handlers) CreateBusinessRule(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	var req struct {
		TableID             uuid.UUID              `json:"table_id"`
		Name                string                 `json:"name"`
		Timing              string                 `json:"timing"`
		ExecutionOrder      int                    `json:"execution_order"`
		ExecutionMode       string                 `json:"execution_mode"`
		RunAsUserID         *uuid.UUID             `json:"run_as_user_id"`
		ConditionExpression map[string]interface{} `json:"condition_expression"`
		ActionType          string                 `json:"action_type"`
		ActionPayload       map[string]interface{} `json:"action_payload"`
		IsActive            *bool                  `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Payload inválido.")
		return
	}

	if req.TableID == uuid.Nil {
		respondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "O campo 'table_id' é obrigatório.")
		return
	}

	var tableExists bool
	_ = h.db.Pool.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM sys_db_object WHERE sys_id = $1)", req.TableID).Scan(&tableExists)
	if !tableExists {
		respondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "A tabela informada não existe no catálogo.")
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		respondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "O nome da regra de negócio é obrigatório.")
		return
	}

	validTimings := map[string]bool{
		"before_insert": true,
		"before_update": true,
		"after_insert":  true,
		"after_update":  true,
	}
	if !validTimings[req.Timing] {
		respondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Timing inválido. Opções válidas: before_insert, before_update, after_insert, after_update.")
		return
	}

	if req.ExecutionOrder <= 0 {
		req.ExecutionOrder = 100
	}

	if req.ExecutionMode == "" {
		req.ExecutionMode = "caller"
	}
	if req.ExecutionMode != "caller" && req.ExecutionMode != "service" {
		respondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Modo de execução inválido. Opções permitidas: caller, service.")
		return
	}

	if req.ExecutionMode == "service" {
		if req.RunAsUserID == nil || *req.RunAsUserID == uuid.Nil {
			respondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Para o modo 'service', o usuário executor (run_as_user_id) é obrigatório.")
			return
		}
		var userExists bool
		_ = h.db.Pool.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM sys_user WHERE sys_id = $1 AND is_active = TRUE)", *req.RunAsUserID).Scan(&userExists)
		if !userExists {
			respondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Usuário executor (run_as_user_id) não encontrado ou inativo.")
			return
		}
	} else {
		req.RunAsUserID = nil
	}

	validActionTypes := map[string]bool{
		"set_field_value":   true,
		"abort_transaction": true,
		"execute_script":    true,
	}
	if !validActionTypes[req.ActionType] {
		respondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Tipo de ação inválido. Opções válidas: set_field_value, abort_transaction, execute_script.")
		return
	}

	condJSON, err := json.Marshal(req.ConditionExpression)
	if err != nil {
		respondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Estrutura JSON da condição inválida.")
		return
	}
	if len(req.ConditionExpression) > 0 {
		if _, err := condition.ParseConditionTree(condJSON); err != nil {
			respondError(w, http.StatusBadRequest, "VALIDATION_ERROR", fmt.Sprintf("Árvore de condição (AST) inválida: %v", err))
			return
		}
	}

	actionJSON, err := json.Marshal(req.ActionPayload)
	if err != nil {
		respondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Payload da ação em formato JSON inválido.")
		return
	}
	if req.ActionType == "abort_transaction" {
		if req.ActionPayload == nil || req.ActionPayload["message"] == nil || strings.TrimSpace(fmt.Sprintf("%v", req.ActionPayload["message"])) == "" {
			respondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Para ação 'abort_transaction', o campo 'message' é obrigatório no payload.")
			return
		}
	} else if req.ActionType == "set_field_value" {
		if req.ActionPayload == nil || req.ActionPayload["field"] == nil || strings.TrimSpace(fmt.Sprintf("%v", req.ActionPayload["field"])) == "" {
			respondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Para ação 'set_field_value', o campo alvo ('field') é obrigatório no payload.")
			return
		}
	} else if req.ActionType == "execute_script" {
		if req.ActionPayload == nil || req.ActionPayload["script"] == nil || strings.TrimSpace(fmt.Sprintf("%v", req.ActionPayload["script"])) == "" {
			respondError(w, http.StatusBadRequest, "VALIDATION_ERROR", "Para ação 'execute_script', o código 'script' é obrigatório no payload.")
			return
		}
	}

	isActive := true
	if req.IsActive != nil {
		isActive = *req.IsActive
	}

	var newID uuid.UUID
	err = auth.ExecuteInTx(r.Context(), h.db, secCtx, func(tx pgx.Tx) error {
		return tx.QueryRow(r.Context(), `
			INSERT INTO sys_script (
				table_id, name, timing, execution_order, execution_mode,
				run_as_user_id, condition_expression, action_type, action_payload, is_active
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			RETURNING sys_id
		`, req.TableID, req.Name, req.Timing, req.ExecutionOrder, req.ExecutionMode, req.RunAsUserID, condJSON, req.ActionType, actionJSON, isActive).Scan(&newID)
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "RULE_CREATE_ERROR", err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, map[string]interface{}{"sys_id": newID})
}

func (h *Handlers) ListBusinessRules(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Pool.Query(r.Context(), `
		SELECT s.sys_id, s.table_id, o.name AS table_name, s.name, s.timing, s.execution_order, s.action_type, s.is_active
		FROM sys_script s
		JOIN sys_db_object o ON o.sys_id = s.table_id
		ORDER BY o.name ASC, s.timing ASC, s.execution_order ASC
	`)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	defer rows.Close()

	list := make([]map[string]interface{}, 0)
	for rows.Next() {
		var sysID, tableID uuid.UUID
		var tableName, name, timing, actionType string
		var order int
		var active bool
		if err := rows.Scan(&sysID, &tableID, &tableName, &name, &timing, &order, &actionType, &active); err == nil {
			list = append(list, map[string]interface{}{
				"sys_id":          sysID,
				"table_id":        tableID,
				"table_name":      tableName,
				"name":            name,
				"timing":          timing,
				"execution_order": order,
				"action_type":     actionType,
				"is_active":       active,
			})
		}
	}

	respondJSON(w, http.StatusOK, list)
}

// 7. Schema Studio CRUD Handlers
func (h *Handlers) GetTable(w http.ResponseWriter, r *http.Request) {
	tableIDStr := chi.URLParam(r, "table_id")
	t, err := h.ddlEngine.GetTable(r.Context(), tableIDStr)
	if err != nil {
		respondError(w, http.StatusNotFound, "NOT_FOUND", err.Error())
		return
	}
	respondJSON(w, http.StatusOK, t)
}

func (h *Handlers) UpdateTable(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	tableIDStr := chi.URLParam(r, "table_id")
	tableID, err := uuid.Parse(tableIDStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Identificador de tabela inválido.")
		return
	}

	var req struct {
		Label        string `json:"label"`
		IsExtendable bool   `json:"is_extendable"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Payload inválido.")
		return
	}

	t, err := h.ddlEngine.UpdateTable(r.Context(), tableID, req.Label, req.IsExtendable, secCtx)
	if err != nil {
		respondError(w, http.StatusBadRequest, "UPDATE_ERROR", err.Error())
		return
	}
	respondJSON(w, http.StatusOK, t)
}

func (h *Handlers) DeleteTable(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	tableIDStr := chi.URLParam(r, "table_id")
	tableID, err := uuid.Parse(tableIDStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Identificador de tabela inválido.")
		return
	}

	if err := h.ddlEngine.DeleteTable(r.Context(), tableID, secCtx); err != nil {
		respondError(w, http.StatusBadRequest, "DELETE_ERROR", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) GetField(w http.ResponseWriter, r *http.Request) {
	fieldIDStr := chi.URLParam(r, "field_id")
	fieldID, err := uuid.Parse(fieldIDStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "field_id inválido.")
		return
	}

	f, err := h.ddlEngine.GetField(r.Context(), fieldID)
	if err != nil {
		respondError(w, http.StatusNotFound, "NOT_FOUND", err.Error())
		return
	}
	respondJSON(w, http.StatusOK, f)
}

func (h *Handlers) UpdateField(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	fieldIDStr := chi.URLParam(r, "field_id")
	fieldID, err := uuid.Parse(fieldIDStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "field_id inválido.")
		return
	}

	var req struct {
		Label        string  `json:"label"`
		IsMandatory  bool    `json:"is_mandatory"`
		IsReadOnly   bool    `json:"is_read_only"`
		DefaultValue *string `json:"default_value"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Payload inválido.")
		return
	}

	f, err := h.ddlEngine.UpdateField(r.Context(), fieldID, req.Label, req.IsMandatory, req.IsReadOnly, req.DefaultValue, secCtx)
	if err != nil {
		respondError(w, http.StatusBadRequest, "UPDATE_ERROR", err.Error())
		return
	}
	respondJSON(w, http.StatusOK, f)
}

func (h *Handlers) DeleteField(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	fieldIDStr := chi.URLParam(r, "field_id")
	fieldID, err := uuid.Parse(fieldIDStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "field_id inválido.")
		return
	}

	if err := h.ddlEngine.DeleteField(r.Context(), fieldID, secCtx); err != nil {
		respondError(w, http.StatusBadRequest, "DELETE_ERROR", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) GetChoice(w http.ResponseWriter, r *http.Request) {
	choiceIDStr := chi.URLParam(r, "choice_id")
	choiceID, err := uuid.Parse(choiceIDStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "choice_id inválido.")
		return
	}

	c, err := h.ddlEngine.GetChoice(r.Context(), choiceID)
	if err != nil {
		respondError(w, http.StatusNotFound, "NOT_FOUND", err.Error())
		return
	}
	respondJSON(w, http.StatusOK, c)
}

func (h *Handlers) UpdateChoice(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	choiceIDStr := chi.URLParam(r, "choice_id")
	choiceID, err := uuid.Parse(choiceIDStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "choice_id inválido.")
		return
	}

	var req struct {
		Label    string `json:"label"`
		Value    string `json:"value"`
		Sequence int    `json:"sequence"`
		IsActive bool   `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Payload inválido.")
		return
	}

	c, err := h.ddlEngine.UpdateChoice(r.Context(), choiceID, req.Label, req.Value, req.Sequence, req.IsActive, secCtx)
	if err != nil {
		respondError(w, http.StatusBadRequest, "UPDATE_ERROR", err.Error())
		return
	}
	respondJSON(w, http.StatusOK, c)
}

func (h *Handlers) DeleteChoice(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	choiceIDStr := chi.URLParam(r, "choice_id")
	choiceID, err := uuid.Parse(choiceIDStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "choice_id inválido.")
		return
	}

	if err := h.ddlEngine.DeleteChoice(r.Context(), choiceID, secCtx); err != nil {
		respondError(w, http.StatusBadRequest, "DELETE_ERROR", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// 8. FSM Management Single & Update & Delete
func (h *Handlers) GetTransition(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "transition_id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "transition_id inválido.")
		return
	}

	var t struct {
		SysID              uuid.UUID              `json:"sys_id"`
		TableID            uuid.UUID              `json:"table_id"`
		TableName          string                 `json:"table_name"`
		StateField         string                 `json:"state_field"`
		FromState          string                 `json:"from_state"`
		ToState            string                 `json:"to_state"`
		Label              string                 `json:"label"`
		RequiredRoleID     *uuid.UUID             `json:"required_role_id"`
		ConditionTree      map[string]interface{} `json:"condition_tree"`
		OnTransitionAction map[string]interface{} `json:"on_transition_action"`
		IsActive           bool                   `json:"is_active"`
		SysCreatedOn       time.Time              `json:"sys_created_on"`
	}

	var condBytes, actionBytes []byte
	err = h.db.Pool.QueryRow(r.Context(), `
		SELECT st.sys_id, st.table_id, o.name, st.state_field, st.from_state, st.to_state,
		       st.label, st.required_role_id, st.condition_tree, st.on_transition_action,
		       st.is_active, st.sys_created_on
		FROM sys_state_transition st
		JOIN sys_db_object o ON o.sys_id = st.table_id
		WHERE st.sys_id = $1
	`, id).Scan(
		&t.SysID, &t.TableID, &t.TableName, &t.StateField, &t.FromState, &t.ToState,
		&t.Label, &t.RequiredRoleID, &condBytes, &actionBytes,
		&t.IsActive, &t.SysCreatedOn,
	)
	if err != nil {
		respondError(w, http.StatusNotFound, "NOT_FOUND", "Transição não encontrada.")
		return
	}

	if len(condBytes) > 0 {
		_ = json.Unmarshal(condBytes, &t.ConditionTree)
	}
	if len(actionBytes) > 0 {
		_ = json.Unmarshal(actionBytes, &t.OnTransitionAction)
	}

	respondJSON(w, http.StatusOK, t)
}

func (h *Handlers) UpdateTransition(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	idStr := chi.URLParam(r, "transition_id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "transition_id inválido.")
		return
	}

	var req struct {
		TableID            *uuid.UUID             `json:"table_id"`
		StateField         *string                `json:"state_field"`
		FromState          *string                `json:"from_state"`
		ToState            *string                `json:"to_state"`
		Label              *string                `json:"label"`
		RequiredRoleID     *uuid.UUID             `json:"required_role_id"`
		ConditionTree      map[string]interface{} `json:"condition_tree"`
		OnTransitionAction map[string]interface{} `json:"on_transition_action"`
		IsActive           *bool                  `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Payload inválido.")
		return
	}

	err = auth.ExecuteInTx(r.Context(), h.db, secCtx, func(tx pgx.Tx) error {
		var curTableID uuid.UUID
		var curStateField, curFromState, curToState, curLabel string
		var curRoleID *uuid.UUID
		var curCond, curAction []byte
		var curActive bool

		err := tx.QueryRow(r.Context(), `
			SELECT table_id, state_field, from_state, to_state, label, required_role_id, condition_tree, on_transition_action, is_active
			FROM sys_state_transition WHERE sys_id = $1
		`, id).Scan(&curTableID, &curStateField, &curFromState, &curToState, &curLabel, &curRoleID, &curCond, &curAction, &curActive)
		if err != nil {
			return errors.New("transição não encontrada")
		}

		if req.TableID != nil && *req.TableID != uuid.Nil {
			curTableID = *req.TableID
		}
		if req.StateField != nil && *req.StateField != "" {
			curStateField = *req.StateField
		}
		if req.FromState != nil && *req.FromState != "" {
			curFromState = *req.FromState
		}
		if req.ToState != nil && *req.ToState != "" {
			curToState = *req.ToState
		}
		if req.Label != nil && *req.Label != "" {
			curLabel = *req.Label
		}
		if req.RequiredRoleID != nil {
			curRoleID = req.RequiredRoleID
		}
		if req.ConditionTree != nil {
			curCond, _ = json.Marshal(req.ConditionTree)
		}
		if req.OnTransitionAction != nil {
			curAction, _ = json.Marshal(req.OnTransitionAction)
		}
		if req.IsActive != nil {
			curActive = *req.IsActive
		}

		cmd, err := tx.Exec(r.Context(), `
			UPDATE sys_state_transition
			SET table_id = $1, state_field = $2, from_state = $3, to_state = $4,
			    label = $5, required_role_id = $6, condition_tree = $7,
			    on_transition_action = $8, is_active = $9
			WHERE sys_id = $10
		`, curTableID, curStateField, curFromState, curToState, curLabel, curRoleID, curCond, curAction, curActive, id)
		if err != nil {
			return err
		}
		if cmd.RowsAffected() == 0 {
			return errors.New("transição não encontrada para atualização")
		}
		return nil
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "UPDATE_ERROR", err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"message": "Transição atualizada com sucesso"})
}

func (h *Handlers) DeleteTransition(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	idStr := chi.URLParam(r, "transition_id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "transition_id inválido.")
		return
	}

	err = auth.ExecuteInTx(r.Context(), h.db, secCtx, func(tx pgx.Tx) error {
		cmd, err := tx.Exec(r.Context(), "DELETE FROM sys_state_transition WHERE sys_id = $1", id)
		if err != nil {
			return err
		}
		if cmd.RowsAffected() == 0 {
			return errors.New("transição não encontrada para exclusão")
		}
		return nil
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "DELETE_ERROR", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// 9. Rules Management Single & Update & Delete
func (h *Handlers) GetBusinessRule(w http.ResponseWriter, r *http.Request) {
	ruleIDStr := chi.URLParam(r, "rule_id")
	ruleID, err := uuid.Parse(ruleIDStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "rule_id inválido.")
		return
	}

	var rInfo struct {
		SysID               uuid.UUID              `json:"sys_id"`
		TableID             uuid.UUID              `json:"table_id"`
		TableName           string                 `json:"table_name"`
		Name                string                 `json:"name"`
		Timing              string                 `json:"timing"`
		ExecutionOrder      int                    `json:"execution_order"`
		ExecutionMode       string                 `json:"execution_mode"`
		RunAsUserID         *uuid.UUID             `json:"run_as_user_id"`
		ConditionExpression map[string]interface{} `json:"condition_expression"`
		ActionType          string                 `json:"action_type"`
		ActionPayload       map[string]interface{} `json:"action_payload"`
		IsActive            bool                   `json:"is_active"`
		SysCreatedOn        time.Time              `json:"sys_created_on"`
	}

	var condBytes, actionBytes []byte
	err = h.db.Pool.QueryRow(r.Context(), `
		SELECT s.sys_id, s.table_id, o.name, s.name, s.timing, s.execution_order,
		       s.execution_mode, s.run_as_user_id, s.condition_expression, s.action_type,
		       s.action_payload, s.is_active, s.sys_created_on
		FROM sys_script s
		JOIN sys_db_object o ON o.sys_id = s.table_id
		WHERE s.sys_id = $1
	`, ruleID).Scan(
		&rInfo.SysID, &rInfo.TableID, &rInfo.TableName, &rInfo.Name, &rInfo.Timing,
		&rInfo.ExecutionOrder, &rInfo.ExecutionMode, &rInfo.RunAsUserID,
		&condBytes, &rInfo.ActionType, &actionBytes, &rInfo.IsActive, &rInfo.SysCreatedOn,
	)
	if err != nil {
		respondError(w, http.StatusNotFound, "NOT_FOUND", "Regra de negócio não encontrada.")
		return
	}

	if len(condBytes) > 0 {
		_ = json.Unmarshal(condBytes, &rInfo.ConditionExpression)
	}
	if len(actionBytes) > 0 {
		_ = json.Unmarshal(actionBytes, &rInfo.ActionPayload)
	}

	respondJSON(w, http.StatusOK, rInfo)
}

func (h *Handlers) UpdateBusinessRule(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	ruleIDStr := chi.URLParam(r, "rule_id")
	ruleID, err := uuid.Parse(ruleIDStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "rule_id inválido.")
		return
	}

	var req struct {
		TableID             *uuid.UUID             `json:"table_id"`
		Name                *string                `json:"name"`
		Timing              *string                `json:"timing"`
		ExecutionOrder      *int                   `json:"execution_order"`
		ExecutionMode       *string                `json:"execution_mode"`
		RunAsUserID         *uuid.UUID             `json:"run_as_user_id"`
		ConditionExpression map[string]interface{} `json:"condition_expression"`
		ActionType          *string                `json:"action_type"`
		ActionPayload       map[string]interface{} `json:"action_payload"`
		IsActive            *bool                  `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Payload inválido.")
		return
	}

	err = auth.ExecuteInTx(r.Context(), h.db, secCtx, func(tx pgx.Tx) error {
		var curTableID uuid.UUID
		var curName, curTiming, curExecMode, curActionType string
		var curOrder int
		var curRunAs *uuid.UUID
		var curCond, curAction []byte
		var curActive bool

		err := tx.QueryRow(r.Context(), `
			SELECT table_id, name, timing, execution_order, execution_mode, run_as_user_id, condition_expression, action_type, action_payload, is_active
			FROM sys_script WHERE sys_id = $1
		`, ruleID).Scan(&curTableID, &curName, &curTiming, &curOrder, &curExecMode, &curRunAs, &curCond, &curActionType, &curAction, &curActive)
		if err != nil {
			return errors.New("regra não encontrada")
		}

		if req.TableID != nil && *req.TableID != uuid.Nil {
			var tableExists bool
			_ = tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM sys_db_object WHERE sys_id = $1)", *req.TableID).Scan(&tableExists)
			if !tableExists {
				return errors.New("tabela especificada não foi encontrada")
			}
			curTableID = *req.TableID
		}
		if req.Name != nil {
			trimmedName := strings.TrimSpace(*req.Name)
			if trimmedName == "" {
				return errors.New("o nome da regra de negócio é obrigatório")
			}
			curName = trimmedName
		}
		if req.Timing != nil {
			validTimings := map[string]bool{
				"before_insert": true,
				"before_update": true,
				"after_insert":  true,
				"after_update":  true,
			}
			if !validTimings[*req.Timing] {
				return errors.New("timing inválido. Opções válidas: before_insert, before_update, after_insert, after_update")
			}
			curTiming = *req.Timing
		}
		if req.ExecutionOrder != nil {
			if *req.ExecutionOrder <= 0 {
				return errors.New("ordem de execução deve ser maior que zero")
			}
			curOrder = *req.ExecutionOrder
		}
		if req.ExecutionMode != nil {
			if *req.ExecutionMode != "caller" && *req.ExecutionMode != "service" {
				return errors.New("modo de execução inválido. Opções válidas: caller, service")
			}
			curExecMode = *req.ExecutionMode
		}
		if req.RunAsUserID != nil {
			curRunAs = req.RunAsUserID
		}
		if curExecMode == "service" {
			if curRunAs == nil || *curRunAs == uuid.Nil {
				return errors.New("para o modo 'service', o usuário executor (run_as_user_id) é obrigatório")
			}
			var userExists bool
			_ = tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM sys_user WHERE sys_id = $1 AND is_active = TRUE)", *curRunAs).Scan(&userExists)
			if !userExists {
				return errors.New("usuário executor (run_as_user_id) não encontrado ou inativo")
			}
		} else {
			curRunAs = nil
		}
		if req.ActionType != nil {
			validActionTypes := map[string]bool{
				"set_field_value":   true,
				"abort_transaction": true,
				"execute_script":    true,
			}
			if !validActionTypes[*req.ActionType] {
				return errors.New("tipo de ação inválido. Opções válidas: set_field_value, abort_transaction, execute_script")
			}
			curActionType = *req.ActionType
		}
		if req.ConditionExpression != nil {
			condB, err := json.Marshal(req.ConditionExpression)
			if err != nil {
				return errors.New("estrutura JSON da condição inválida")
			}
			if len(req.ConditionExpression) > 0 {
				if _, err := condition.ParseConditionTree(condB); err != nil {
					return fmt.Errorf("árvore de condição (AST) inválida: %w", err)
				}
			}
			curCond = condB
		}
		if req.ActionPayload != nil {
			actionB, err := json.Marshal(req.ActionPayload)
			if err != nil {
				return errors.New("payload da ação inválido")
			}
			if curActionType == "abort_transaction" {
				if req.ActionPayload["message"] == nil || strings.TrimSpace(fmt.Sprintf("%v", req.ActionPayload["message"])) == "" {
					return errors.New("para 'abort_transaction', o campo 'message' é obrigatório no payload")
				}
			} else if curActionType == "set_field_value" {
				if req.ActionPayload["field"] == nil || strings.TrimSpace(fmt.Sprintf("%v", req.ActionPayload["field"])) == "" {
					return errors.New("para 'set_field_value', o campo alvo ('field') é obrigatório no payload")
				}
			} else if curActionType == "execute_script" {
				if req.ActionPayload["script"] == nil || strings.TrimSpace(fmt.Sprintf("%v", req.ActionPayload["script"])) == "" {
					return errors.New("para 'execute_script', o código do script ('script') é obrigatório no payload")
				}
			}
			curAction = actionB
		}
		if req.IsActive != nil {
			curActive = *req.IsActive
		}

		cmd, err := tx.Exec(r.Context(), `
			UPDATE sys_script
			SET table_id = $1, name = $2, timing = $3, execution_order = $4,
			    execution_mode = $5, run_as_user_id = $6, condition_expression = $7,
			    action_type = $8, action_payload = $9, is_active = $10
			WHERE sys_id = $11
		`, curTableID, curName, curTiming, curOrder, curExecMode, curRunAs, curCond, curActionType, curAction, curActive, ruleID)
		if err != nil {
			return err
		}
		if cmd.RowsAffected() == 0 {
			return errors.New("regra não encontrada para atualização")
		}
		return nil
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "UPDATE_ERROR", err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"message": "Regra atualizada com sucesso"})
}

func (h *Handlers) DeleteBusinessRule(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	ruleIDStr := chi.URLParam(r, "rule_id")
	ruleID, err := uuid.Parse(ruleIDStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "rule_id inválido.")
		return
	}

	err = auth.ExecuteInTx(r.Context(), h.db, secCtx, func(tx pgx.Tx) error {
		cmd, err := tx.Exec(r.Context(), "DELETE FROM sys_script WHERE sys_id = $1", ruleID)
		if err != nil {
			return err
		}
		if cmd.RowsAffected() == 0 {
			return errors.New("regra não encontrada para exclusão")
		}
		return nil
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "DELETE_ERROR", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// 10. RBAC Handlers
func (h *Handlers) ListUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Pool.Query(r.Context(), `
		SELECT u.sys_id, u.user_name, u.first_name, COALESCE(u.last_name, ''),
		       COALESCE(u.email, ''), COALESCE(u.phone, ''), COALESCE(u.job_title, ''),
		       COALESCE(u.department, ''), COALESCE(u.company, ''), u.is_active,
		       u.sys_created_on,
		       (SELECT COUNT(*) FROM sys_user_grmember gm WHERE gm.user_id = u.sys_id) AS groups_count
		FROM sys_user u
		ORDER BY u.user_name ASC
	`)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	defer rows.Close()

	type UserSummary struct {
		SysID        uuid.UUID `json:"sys_id"`
		UserName     string    `json:"user_name"`
		FirstName    string    `json:"first_name"`
		LastName     string    `json:"last_name"`
		Email        string    `json:"email"`
		Phone        string    `json:"phone"`
		JobTitle     string    `json:"job_title"`
		Department   string    `json:"department"`
		Company      string    `json:"company"`
		IsActive     bool      `json:"is_active"`
		SysCreatedOn time.Time `json:"sys_created_on"`
		GroupsCount  int       `json:"groups_count"`
	}

	list := make([]UserSummary, 0)
	for rows.Next() {
		var u UserSummary
		if err := rows.Scan(
			&u.SysID, &u.UserName, &u.FirstName, &u.LastName,
			&u.Email, &u.Phone, &u.JobTitle, &u.Department, &u.Company,
			&u.IsActive, &u.SysCreatedOn, &u.GroupsCount,
		); err == nil {
			list = append(list, u)
		}
	}
	respondJSON(w, http.StatusOK, list)
}

func (h *Handlers) GetUser(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "user_id")
	userID, err := uuid.Parse(idStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "user_id inválido.")
		return
	}

	var u struct {
		SysID        uuid.UUID   `json:"sys_id"`
		UserName     string      `json:"user_name"`
		FirstName    string      `json:"first_name"`
		LastName     string      `json:"last_name"`
		Email        string      `json:"email"`
		Phone        string      `json:"phone"`
		JobTitle     string      `json:"job_title"`
		Department   string      `json:"department"`
		Company      string      `json:"company"`
		IsActive     bool        `json:"is_active"`
		SysCreatedOn time.Time   `json:"sys_created_on"`
		GroupIDs     []uuid.UUID `json:"group_ids"`
	}

	var last, email, phone, job, dept, comp *string
	err = h.db.Pool.QueryRow(r.Context(), `
		SELECT sys_id, user_name, first_name, last_name, email, phone, job_title, department, company, is_active, sys_created_on
		FROM sys_user WHERE sys_id = $1
	`, userID).Scan(
		&u.SysID, &u.UserName, &u.FirstName, &last, &email, &phone, &job, &dept, &comp, &u.IsActive, &u.SysCreatedOn,
	)
	if err != nil {
		respondError(w, http.StatusNotFound, "NOT_FOUND", "Usuário não encontrado.")
		return
	}
	if last != nil { u.LastName = *last }
	if email != nil { u.Email = *email }
	if phone != nil { u.Phone = *phone }
	if job != nil { u.JobTitle = *job }
	if dept != nil { u.Department = *dept }
	if comp != nil { u.Company = *comp }

	// Get user groups
	gRows, err := h.db.Pool.Query(r.Context(), "SELECT group_id FROM sys_user_grmember WHERE user_id = $1", userID)
	if err == nil {
		defer gRows.Close()
		u.GroupIDs = make([]uuid.UUID, 0)
		for gRows.Next() {
			var gid uuid.UUID
			if err := gRows.Scan(&gid); err == nil {
				u.GroupIDs = append(u.GroupIDs, gid)
			}
		}
	}

	respondJSON(w, http.StatusOK, u)
}

func (h *Handlers) CreateUser(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	var req struct {
		UserName   string      `json:"user_name"`
		FirstName  string      `json:"first_name"`
		LastName   string      `json:"last_name"`
		Email      string      `json:"email"`
		Phone      string      `json:"phone"`
		JobTitle   string      `json:"job_title"`
		Department string      `json:"department"`
		Company    string      `json:"company"`
		IsActive   bool        `json:"is_active"`
		Password   string      `json:"password"`
		GroupIDs   []uuid.UUID `json:"group_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Payload inválido.")
		return
	}

	if strings.TrimSpace(req.UserName) == "" || strings.TrimSpace(req.FirstName) == "" {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "user_name e first_name são obrigatórios.")
		return
	}
	if req.Password == "" {
		req.Password = "Mudar123!Padrao"
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Falha ao gerar hash da senha.")
		return
	}

	var newUserID uuid.UUID
	err = auth.ExecuteInTx(r.Context(), h.db, secCtx, func(tx pgx.Tx) error {
		err := tx.QueryRow(r.Context(), `
			INSERT INTO sys_user (
				user_name, first_name, last_name, email, phone, job_title, department, company,
				is_active, sys_created_by, sys_updated_by
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
			RETURNING sys_id
		`, req.UserName, req.FirstName, req.LastName, req.Email, req.Phone, req.JobTitle, req.Department, req.Company, req.IsActive, secCtx.UserID).Scan(&newUserID)
		if err != nil {
			return err
		}

		// Insert credential
		_, err = tx.Exec(r.Context(), `
			INSERT INTO sys_user_credential (user_id, password_hash, algorithm)
			VALUES ($1, $2, 'bcrypt')
		`, newUserID, string(hash))
		if err != nil {
			return err
		}

		// Insert group memberships
		for _, gid := range req.GroupIDs {
			_, _ = tx.Exec(r.Context(), `
				INSERT INTO sys_user_grmember (user_id, group_id)
				VALUES ($1, $2) ON CONFLICT DO NOTHING
			`, newUserID, gid)
		}

		return nil
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "CREATE_ERROR", err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, map[string]interface{}{"sys_id": newUserID})
}

func (h *Handlers) UpdateUser(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	idStr := chi.URLParam(r, "user_id")
	userID, err := uuid.Parse(idStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "user_id inválido.")
		return
	}

	var req struct {
		FirstName  string      `json:"first_name"`
		LastName   string      `json:"last_name"`
		Email      string      `json:"email"`
		Phone      string      `json:"phone"`
		JobTitle   string      `json:"job_title"`
		Department string      `json:"department"`
		Company    string      `json:"company"`
		IsActive   bool        `json:"is_active"`
		Password   string      `json:"password,omitempty"`
		GroupIDs   []uuid.UUID `json:"group_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Payload inválido.")
		return
	}

	var curFirst, curLast, curEmail string
	var curPhone, curJob, curDept, curComp *string
	var curActive bool

	err = auth.ExecuteInTx(r.Context(), h.db, secCtx, func(tx pgx.Tx) error {
		err := tx.QueryRow(r.Context(), `
			SELECT first_name, last_name, email, phone, job_title, department, company, is_active
			FROM sys_user WHERE sys_id = $1
		`, userID).Scan(&curFirst, &curLast, &curEmail, &curPhone, &curJob, &curDept, &curComp, &curActive)
		if err != nil {
			return errors.New("usuário não encontrado")
		}

		if strings.TrimSpace(req.FirstName) != "" { curFirst = req.FirstName }
		if strings.TrimSpace(req.LastName) != "" { curLast = req.LastName }
		if strings.TrimSpace(req.Email) != "" { curEmail = req.Email }
		if req.Phone != "" { curPhone = &req.Phone }
		if req.JobTitle != "" { curJob = &req.JobTitle }
		if req.Department != "" { curDept = &req.Department }
		if req.Company != "" { curComp = &req.Company }
		curActive = req.IsActive

		cmd, err := tx.Exec(r.Context(), `
			UPDATE sys_user
			SET first_name = $1, last_name = $2, email = $3, phone = $4, job_title = $5,
			    department = $6, company = $7, is_active = $8, sys_updated_on = clock_timestamp(),
			    sys_updated_by = $9
			WHERE sys_id = $10
		`, curFirst, curLast, curEmail, curPhone, curJob, curDept, curComp, curActive, secCtx.UserID, userID)
		if err != nil {
			return err
		}
		if cmd.RowsAffected() == 0 {
			return errors.New("usuário não encontrado para atualização")
		}

		// If password provided, update hash
		if strings.TrimSpace(req.Password) != "" {
			hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
			if err != nil {
				return err
			}
			_, err = tx.Exec(r.Context(), `
				INSERT INTO sys_user_credential (user_id, password_hash, algorithm)
				VALUES ($1, $2, 'bcrypt')
				ON CONFLICT (user_id) DO UPDATE SET password_hash = $2, failed_attempts = 0, locked_until = NULL
			`, userID, string(hash))
			if err != nil {
				return err
			}
		}

		// Sync group memberships if provided
		if req.GroupIDs != nil {
			_, _ = tx.Exec(r.Context(), "DELETE FROM sys_user_grmember WHERE user_id = $1", userID)
			for _, gid := range req.GroupIDs {
				_, _ = tx.Exec(r.Context(), `
					INSERT INTO sys_user_grmember (user_id, group_id)
					VALUES ($1, $2) ON CONFLICT DO NOTHING
				`, userID, gid)
			}
		}

		return nil
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "UPDATE_ERROR", err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"message":    "Usuário atualizado com sucesso",
		"first_name": curFirst,
		"last_name":  curLast,
	})
}

func (h *Handlers) DeleteUser(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	idStr := chi.URLParam(r, "user_id")
	userID, err := uuid.Parse(idStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "user_id inválido.")
		return
	}

	if userID == database.AdminUserID || userID == database.SystemServiceUserID {
		respondError(w, http.StatusBadRequest, "FORBIDDEN", "Não é permitido excluir o usuário Administrador ou a Conta de Serviço do sistema.")
		return
	}

	err = auth.ExecuteInTx(r.Context(), h.db, secCtx, func(tx pgx.Tx) error {
		_, _ = tx.Exec(r.Context(), "DELETE FROM sys_user_grmember WHERE user_id = $1", userID)
		_, _ = tx.Exec(r.Context(), "DELETE FROM sys_user_credential WHERE user_id = $1", userID)

		cmd, err := tx.Exec(r.Context(), "DELETE FROM sys_user WHERE sys_id = $1", userID)
		if err != nil {
			return err
		}
		if cmd.RowsAffected() == 0 {
			return errors.New("usuário não encontrado para exclusão")
		}
		return nil
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "DELETE_ERROR", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) ListGroups(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Pool.Query(r.Context(), `
		SELECT g.sys_id, g.name, COALESCE(g.description, ''), g.is_active, g.sys_created_on,
		       (SELECT COUNT(*) FROM sys_user_grmember gm WHERE gm.group_id = g.sys_id) AS members_count,
		       (SELECT COUNT(*) FROM sys_group_has_role gr WHERE gr.group_id = g.sys_id) AS roles_count
		FROM sys_user_group g
		ORDER BY g.name ASC
	`)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	defer rows.Close()

	type GroupSummary struct {
		SysID        uuid.UUID `json:"sys_id"`
		Name         string    `json:"name"`
		Description  string    `json:"description"`
		IsActive     bool      `json:"is_active"`
		SysCreatedOn time.Time `json:"sys_created_on"`
		MembersCount int       `json:"members_count"`
		RolesCount   int       `json:"roles_count"`
	}

	list := make([]GroupSummary, 0)
	for rows.Next() {
		var g GroupSummary
		if err := rows.Scan(&g.SysID, &g.Name, &g.Description, &g.IsActive, &g.SysCreatedOn, &g.MembersCount, &g.RolesCount); err == nil {
			list = append(list, g)
		}
	}
	respondJSON(w, http.StatusOK, list)
}

func (h *Handlers) GetGroup(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "group_id")
	groupID, err := uuid.Parse(idStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "group_id inválido.")
		return
	}

	var g struct {
		SysID        uuid.UUID   `json:"sys_id"`
		Name         string      `json:"name"`
		Description  string      `json:"description"`
		IsActive     bool        `json:"is_active"`
		SysCreatedOn time.Time   `json:"sys_created_on"`
		RoleIDs      []uuid.UUID `json:"role_ids"`
	}

	var desc *string
	err = h.db.Pool.QueryRow(r.Context(), `
		SELECT sys_id, name, description, is_active, sys_created_on
		FROM sys_user_group WHERE sys_id = $1
	`, groupID).Scan(&g.SysID, &g.Name, &desc, &g.IsActive, &g.SysCreatedOn)
	if err != nil {
		respondError(w, http.StatusNotFound, "NOT_FOUND", "Grupo não encontrado.")
		return
	}
	if desc != nil { g.Description = *desc }

	rRows, err := h.db.Pool.Query(r.Context(), "SELECT role_id FROM sys_group_has_role WHERE group_id = $1", groupID)
	if err == nil {
		defer rRows.Close()
		g.RoleIDs = make([]uuid.UUID, 0)
		for rRows.Next() {
			var rid uuid.UUID
			if err := rRows.Scan(&rid); err == nil {
				g.RoleIDs = append(g.RoleIDs, rid)
			}
		}
	}

	respondJSON(w, http.StatusOK, g)
}

func (h *Handlers) CreateGroup(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	var req struct {
		Name        string      `json:"name"`
		Description string      `json:"description"`
		IsActive    bool        `json:"is_active"`
		RoleIDs     []uuid.UUID `json:"role_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Payload inválido.")
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Nome do grupo é obrigatório.")
		return
	}

	var newGroupID uuid.UUID
	err := auth.ExecuteInTx(r.Context(), h.db, secCtx, func(tx pgx.Tx) error {
		err := tx.QueryRow(r.Context(), `
			INSERT INTO sys_user_group (name, description, is_active, sys_created_by, sys_updated_by)
			VALUES ($1, $2, $3, $4, $4)
			RETURNING sys_id
		`, req.Name, req.Description, req.IsActive, secCtx.UserID).Scan(&newGroupID)
		if err != nil {
			return err
		}

		for _, rid := range req.RoleIDs {
			_, _ = tx.Exec(r.Context(), `
				INSERT INTO sys_group_has_role (group_id, role_id)
				VALUES ($1, $2) ON CONFLICT DO NOTHING
			`, newGroupID, rid)
		}
		return nil
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "CREATE_ERROR", err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, map[string]interface{}{"sys_id": newGroupID})
}

func (h *Handlers) UpdateGroup(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	idStr := chi.URLParam(r, "group_id")
	groupID, err := uuid.Parse(idStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "group_id inválido.")
		return
	}

	var req struct {
		Name        string      `json:"name"`
		Description string      `json:"description"`
		IsActive    bool        `json:"is_active"`
		RoleIDs     []uuid.UUID `json:"role_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Payload inválido.")
		return
	}

	var curName, curDesc string
	var curActive bool

	err = auth.ExecuteInTx(r.Context(), h.db, secCtx, func(tx pgx.Tx) error {
		err := tx.QueryRow(r.Context(), "SELECT name, COALESCE(description, ''), is_active FROM sys_user_group WHERE sys_id = $1", groupID).Scan(&curName, &curDesc, &curActive)
		if err != nil {
			return errors.New("grupo não encontrado")
		}
		if strings.TrimSpace(req.Name) != "" {
			curName = req.Name
		}
		if req.Description != "" {
			curDesc = req.Description
		}
		curActive = req.IsActive

		cmd, err := tx.Exec(r.Context(), `
			UPDATE sys_user_group
			SET name = $1, description = $2, is_active = $3, sys_updated_on = clock_timestamp(),
			    sys_updated_by = $4
			WHERE sys_id = $5
		`, curName, curDesc, curActive, secCtx.UserID, groupID)
		if err != nil {
			return err
		}
		if cmd.RowsAffected() == 0 {
			return errors.New("grupo não encontrado para atualização")
		}

		if req.RoleIDs != nil {
			_, _ = tx.Exec(r.Context(), "DELETE FROM sys_group_has_role WHERE group_id = $1", groupID)
			for _, rid := range req.RoleIDs {
				_, _ = tx.Exec(r.Context(), `
					INSERT INTO sys_group_has_role (group_id, role_id)
					VALUES ($1, $2) ON CONFLICT DO NOTHING
				`, groupID, rid)
			}
		}
		return nil
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "UPDATE_ERROR", err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"message":     "Grupo atualizado com sucesso",
		"name":        curName,
		"description": curDesc,
	})
}

func (h *Handlers) DeleteGroup(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	idStr := chi.URLParam(r, "group_id")
	groupID, err := uuid.Parse(idStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "group_id inválido.")
		return
	}

	if groupID == database.AdminGroupID {
		respondError(w, http.StatusBadRequest, "FORBIDDEN", "Não é permitido excluir o grupo de Administradores do sistema.")
		return
	}

	err = auth.ExecuteInTx(r.Context(), h.db, secCtx, func(tx pgx.Tx) error {
		_, _ = tx.Exec(r.Context(), "DELETE FROM sys_group_has_role WHERE group_id = $1", groupID)
		_, _ = tx.Exec(r.Context(), "DELETE FROM sys_user_grmember WHERE group_id = $1", groupID)

		cmd, err := tx.Exec(r.Context(), "DELETE FROM sys_user_group WHERE sys_id = $1", groupID)
		if err != nil {
			return err
		}
		if cmd.RowsAffected() == 0 {
			return errors.New("grupo não encontrado para exclusão")
		}
		return nil
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "DELETE_ERROR", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) ListRoles(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Pool.Query(r.Context(), `
		SELECT r.sys_id, r.name, COALESCE(r.description, ''), r.is_active, r.sys_created_on,
		       (SELECT COUNT(*) FROM sys_role_has_permission rp WHERE rp.role_id = r.sys_id) AS permissions_count
		FROM sys_user_role r
		ORDER BY r.name ASC
	`)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	defer rows.Close()

	type RoleSummary struct {
		SysID            uuid.UUID `json:"sys_id"`
		Name             string    `json:"name"`
		Description      string    `json:"description"`
		IsActive         bool      `json:"is_active"`
		SysCreatedOn     time.Time `json:"sys_created_on"`
		PermissionsCount int       `json:"permissions_count"`
	}

	list := make([]RoleSummary, 0)
	for rows.Next() {
		var role RoleSummary
		if err := rows.Scan(&role.SysID, &role.Name, &role.Description, &role.IsActive, &role.SysCreatedOn, &role.PermissionsCount); err == nil {
			list = append(list, role)
		}
	}
	respondJSON(w, http.StatusOK, list)
}

func (h *Handlers) GetRole(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "role_id")
	roleID, err := uuid.Parse(idStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "role_id inválido.")
		return
	}

	var role struct {
		SysID         uuid.UUID   `json:"sys_id"`
		Name          string      `json:"name"`
		Description   string      `json:"description"`
		IsActive      bool        `json:"is_active"`
		SysCreatedOn  time.Time   `json:"sys_created_on"`
		PermissionIDs []uuid.UUID `json:"permission_ids"`
	}

	var desc *string
	err = h.db.Pool.QueryRow(r.Context(), `
		SELECT sys_id, name, description, is_active, sys_created_on
		FROM sys_user_role WHERE sys_id = $1
	`, roleID).Scan(&role.SysID, &role.Name, &desc, &role.IsActive, &role.SysCreatedOn)
	if err != nil {
		respondError(w, http.StatusNotFound, "NOT_FOUND", "Papel não encontrado.")
		return
	}
	if desc != nil { role.Description = *desc }

	pRows, err := h.db.Pool.Query(r.Context(), "SELECT permission_id FROM sys_role_has_permission WHERE role_id = $1", roleID)
	if err == nil {
		defer pRows.Close()
		role.PermissionIDs = make([]uuid.UUID, 0)
		for pRows.Next() {
			var pid uuid.UUID
			if err := pRows.Scan(&pid); err == nil {
				role.PermissionIDs = append(role.PermissionIDs, pid)
			}
		}
	}

	respondJSON(w, http.StatusOK, role)
}

func (h *Handlers) CreateRole(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	var req struct {
		Name          string      `json:"name"`
		Description   string      `json:"description"`
		IsActive      bool        `json:"is_active"`
		PermissionIDs []uuid.UUID `json:"permission_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Payload inválido.")
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Nome da role é obrigatório.")
		return
	}

	var newRoleID uuid.UUID
	err := auth.ExecuteInTx(r.Context(), h.db, secCtx, func(tx pgx.Tx) error {
		err := tx.QueryRow(r.Context(), `
			INSERT INTO sys_user_role (name, description, is_active, sys_created_by, sys_updated_by)
			VALUES ($1, $2, $3, $4, $4)
			RETURNING sys_id
		`, req.Name, req.Description, req.IsActive, secCtx.UserID).Scan(&newRoleID)
		if err != nil {
			return err
		}

		for _, pid := range req.PermissionIDs {
			_, _ = tx.Exec(r.Context(), `
				INSERT INTO sys_role_has_permission (role_id, permission_id)
				VALUES ($1, $2) ON CONFLICT DO NOTHING
			`, newRoleID, pid)
		}
		return nil
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "CREATE_ERROR", err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, map[string]interface{}{"sys_id": newRoleID})
}

func (h *Handlers) UpdateRole(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	idStr := chi.URLParam(r, "role_id")
	roleID, err := uuid.Parse(idStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "role_id inválido.")
		return
	}

	var req struct {
		Name          string      `json:"name"`
		Description   string      `json:"description"`
		IsActive      bool        `json:"is_active"`
		PermissionIDs []uuid.UUID `json:"permission_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Payload inválido.")
		return
	}

	var curName, curDesc string
	var curActive bool

	err = auth.ExecuteInTx(r.Context(), h.db, secCtx, func(tx pgx.Tx) error {
		err := tx.QueryRow(r.Context(), "SELECT name, COALESCE(description, ''), is_active FROM sys_user_role WHERE sys_id = $1", roleID).Scan(&curName, &curDesc, &curActive)
		if err != nil {
			return errors.New("papel não encontrado")
		}
		if strings.TrimSpace(req.Name) != "" {
			curName = req.Name
		}
		if req.Description != "" {
			curDesc = req.Description
		}
		curActive = req.IsActive

		cmd, err := tx.Exec(r.Context(), `
			UPDATE sys_user_role
			SET name = $1, description = $2, is_active = $3, sys_updated_on = clock_timestamp(),
			    sys_updated_by = $4
			WHERE sys_id = $5
		`, curName, curDesc, curActive, secCtx.UserID, roleID)
		if err != nil {
			return err
		}
		if cmd.RowsAffected() == 0 {
			return errors.New("papel não encontrado para atualização")
		}

		if req.PermissionIDs != nil {
			_, _ = tx.Exec(r.Context(), "DELETE FROM sys_role_has_permission WHERE role_id = $1", roleID)
			for _, pid := range req.PermissionIDs {
				_, _ = tx.Exec(r.Context(), `
					INSERT INTO sys_role_has_permission (role_id, permission_id)
					VALUES ($1, $2) ON CONFLICT DO NOTHING
				`, roleID, pid)
			}
		}
		return nil
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "UPDATE_ERROR", err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"message":     "Papel atualizado com sucesso",
		"name":        curName,
		"description": curDesc,
	})
}

func (h *Handlers) DeleteRole(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	idStr := chi.URLParam(r, "role_id")
	roleID, err := uuid.Parse(idStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "role_id inválido.")
		return
	}

	if roleID == database.AdminRoleID {
		respondError(w, http.StatusBadRequest, "FORBIDDEN", "Não é permitido excluir o papel de Administrador do sistema.")
		return
	}

	err = auth.ExecuteInTx(r.Context(), h.db, secCtx, func(tx pgx.Tx) error {
		_, _ = tx.Exec(r.Context(), "DELETE FROM sys_role_has_permission WHERE role_id = $1", roleID)
		_, _ = tx.Exec(r.Context(), "DELETE FROM sys_group_has_role WHERE role_id = $1", roleID)

		cmd, err := tx.Exec(r.Context(), "DELETE FROM sys_user_role WHERE sys_id = $1", roleID)
		if err != nil {
			return err
		}
		if cmd.RowsAffected() == 0 {
			return errors.New("papel não encontrado para exclusão")
		}
		return nil
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "DELETE_ERROR", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) ListPermissions(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Pool.Query(r.Context(), `
		SELECT p.sys_id, p.name, COALESCE(p.description, ''), p.table_id, o.name AS table_name,
		       p.operation, COALESCE(p.field_name, ''), COALESCE(p.action_name, ''), p.is_active
		FROM sys_permission p
		JOIN sys_db_object o ON o.sys_id = p.table_id
		ORDER BY p.name ASC
	`)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	defer rows.Close()

	type PermSummary struct {
		SysID       uuid.UUID `json:"sys_id"`
		Name        string    `json:"name"`
		Description string    `json:"description"`
		TableID     uuid.UUID `json:"table_id"`
		TableName   string    `json:"table_name"`
		Operation   string    `json:"operation"`
		FieldName   string    `json:"field_name"`
		ActionName  string    `json:"action_name"`
		IsActive    bool      `json:"is_active"`
	}

	list := make([]PermSummary, 0)
	for rows.Next() {
		var p PermSummary
		if err := rows.Scan(
			&p.SysID, &p.Name, &p.Description, &p.TableID, &p.TableName,
			&p.Operation, &p.FieldName, &p.ActionName, &p.IsActive,
		); err == nil {
			list = append(list, p)
		}
	}
	respondJSON(w, http.StatusOK, list)
}

func (h *Handlers) GetPermission(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "permission_id")
	permID, err := uuid.Parse(idStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "permission_id inválido.")
		return
	}

	var p struct {
		SysID         uuid.UUID              `json:"sys_id"`
		Name          string                 `json:"name"`
		Description   string                 `json:"description"`
		TableID       uuid.UUID              `json:"table_id"`
		TableName     string                 `json:"table_name"`
		Operation     string                 `json:"operation"`
		FieldName     string                 `json:"field_name"`
		ActionName    string                 `json:"action_name"`
		ConditionTree map[string]interface{} `json:"condition_tree"`
		IsActive      bool                   `json:"is_active"`
	}

	var desc, field, action *string
	var condBytes []byte
	err = h.db.Pool.QueryRow(r.Context(), `
		SELECT p.sys_id, p.name, p.description, p.table_id, o.name, p.operation,
		       p.field_name, p.action_name, p.condition_tree, p.is_active
		FROM sys_permission p
		JOIN sys_db_object o ON o.sys_id = p.table_id
		WHERE p.sys_id = $1
	`, permID).Scan(&p.SysID, &p.Name, &desc, &p.TableID, &p.TableName, &p.Operation, &field, &action, &condBytes, &p.IsActive)
	if err != nil {
		respondError(w, http.StatusNotFound, "NOT_FOUND", "Permissão não encontrada.")
		return
	}
	if desc != nil { p.Description = *desc }
	if field != nil { p.FieldName = *field }
	if action != nil { p.ActionName = *action }
	if len(condBytes) > 0 {
		_ = json.Unmarshal(condBytes, &p.ConditionTree)
	}

	respondJSON(w, http.StatusOK, p)
}

func (h *Handlers) CreatePermission(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	var req struct {
		Name          string                 `json:"name"`
		Description   string                 `json:"description"`
		TableID       uuid.UUID              `json:"table_id"`
		Operation     string                 `json:"operation"`
		FieldName     *string                `json:"field_name"`
		ActionName    *string                `json:"action_name"`
		ConditionTree map[string]interface{} `json:"condition_tree"`
		IsActive      bool                   `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Payload inválido.")
		return
	}

	condJSON, _ := json.Marshal(req.ConditionTree)
	var newID uuid.UUID
	err := auth.ExecuteInTx(r.Context(), h.db, secCtx, func(tx pgx.Tx) error {
		return tx.QueryRow(r.Context(), `
			INSERT INTO sys_permission (
				name, description, table_id, operation, field_name, action_name,
				condition_tree, is_active
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			RETURNING sys_id
		`, req.Name, req.Description, req.TableID, req.Operation, req.FieldName, req.ActionName, condJSON, req.IsActive).Scan(&newID)
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "CREATE_ERROR", err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, map[string]interface{}{"sys_id": newID})
}

func (h *Handlers) UpdatePermission(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	idStr := chi.URLParam(r, "permission_id")
	permID, err := uuid.Parse(idStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "permission_id inválido.")
		return
	}

	var req struct {
		Name          string                 `json:"name"`
		Description   string                 `json:"description"`
		TableID       uuid.UUID              `json:"table_id"`
		Operation     string                 `json:"operation"`
		FieldName     *string                `json:"field_name"`
		ActionName    *string                `json:"action_name"`
		ConditionTree map[string]interface{} `json:"condition_tree"`
		IsActive      bool                   `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Payload inválido.")
		return
	}

	var curName, curDesc, curOp string
	var curTableID uuid.UUID
	var curField, curAction *string
	var curCondBytes []byte
	var curActive bool

	err = auth.ExecuteInTx(r.Context(), h.db, secCtx, func(tx pgx.Tx) error {
		err := tx.QueryRow(r.Context(), `
			SELECT name, COALESCE(description, ''), table_id, operation, field_name, action_name, condition_tree, is_active
			FROM sys_permission WHERE sys_id = $1
		`, permID).Scan(&curName, &curDesc, &curTableID, &curOp, &curField, &curAction, &curCondBytes, &curActive)
		if err != nil {
			return errors.New("permissão não encontrada")
		}

		if strings.TrimSpace(req.Name) != "" {
			curName = req.Name
		}
		if req.Description != "" {
			curDesc = req.Description
		}
		if req.TableID != uuid.Nil {
			curTableID = req.TableID
		}
		if strings.TrimSpace(req.Operation) != "" {
			curOp = req.Operation
		}
		if req.FieldName != nil {
			curField = req.FieldName
		}
		if req.ActionName != nil {
			curAction = req.ActionName
		}
		if req.ConditionTree != nil {
			curCondBytes, _ = json.Marshal(req.ConditionTree)
		}
		curActive = req.IsActive

		cmd, err := tx.Exec(r.Context(), `
			UPDATE sys_permission
			SET name = $1, description = $2, table_id = $3, operation = $4,
			    field_name = $5, action_name = $6, condition_tree = $7, is_active = $8
			WHERE sys_id = $9
		`, curName, curDesc, curTableID, curOp, curField, curAction, curCondBytes, curActive, permID)
		if err != nil {
			return err
		}
		if cmd.RowsAffected() == 0 {
			return errors.New("permissão não encontrada para atualização")
		}
		return nil
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "UPDATE_ERROR", err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"message":     "Permissão atualizada com sucesso",
		"name":        curName,
		"description": curDesc,
	})
}

func (h *Handlers) DeletePermission(w http.ResponseWriter, r *http.Request) {
	secCtx := auth.GetSecurityContext(r.Context())
	idStr := chi.URLParam(r, "permission_id")
	permID, err := uuid.Parse(idStr)
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "permission_id inválido.")
		return
	}

	err = auth.ExecuteInTx(r.Context(), h.db, secCtx, func(tx pgx.Tx) error {
		_, _ = tx.Exec(r.Context(), "DELETE FROM sys_role_has_permission WHERE permission_id = $1", permID)

		cmd, err := tx.Exec(r.Context(), "DELETE FROM sys_permission WHERE sys_id = $1", permID)
		if err != nil {
			return err
		}
		if cmd.RowsAffected() == 0 {
			return errors.New("permissão não encontrada para exclusão")
		}
		return nil
	})
	if err != nil {
		respondError(w, http.StatusBadRequest, "DELETE_ERROR", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// Helpers
func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func respondError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(auth.ErrorResponse{
		Error: auth.APIError{
			Code:    code,
			Message: message,
		},
	})
}

