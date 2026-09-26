package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"tableengine/internal/audit"
	"tableengine/internal/auth"
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
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "Payload inválido.")
		return
	}
	if req.ExecutionMode == "" {
		req.ExecutionMode = "caller"
	}
	if req.ExecutionOrder <= 0 {
		req.ExecutionOrder = 100
	}

	condJSON, _ := json.Marshal(req.ConditionExpression)
	actionJSON, _ := json.Marshal(req.ActionPayload)

	var newID uuid.UUID
	err := auth.ExecuteInTx(r.Context(), h.db, secCtx, func(tx pgx.Tx) error {
		return tx.QueryRow(r.Context(), `
			INSERT INTO sys_script (
				table_id, name, timing, execution_order, execution_mode,
				run_as_user_id, condition_expression, action_type, action_payload
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			RETURNING sys_id
		`, req.TableID, req.Name, req.Timing, req.ExecutionOrder, req.ExecutionMode, req.RunAsUserID, condJSON, req.ActionType, actionJSON).Scan(&newID)
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
