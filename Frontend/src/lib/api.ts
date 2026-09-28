// API Client for TableEngine REST API

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

export interface User {
  sys_id: string;
  user_name: string;
  first_name: string;
  last_name?: string;
  email?: string;
  is_active: boolean;
  groups: { sys_id: string; name: string }[];
  roles: { sys_id: string; name: string }[];
}

export interface TableInfo {
  sys_id: string;
  name: string;
  label: string;
  super_class_id?: string | null;
  is_extendable: boolean;
  is_kernel_table: boolean;
  view_name?: string;
  sys_created_on: string;
}

export interface FieldInfo {
  sys_id: string;
  table_id: string;
  column_name: string;
  label: string;
  internal_type: string;
  max_length: number;
  is_mandatory: boolean;
  is_read_only: boolean;
  default_value?: string | null;
  reference_table_id?: string | null;
  defined_in_table?: string;
  inheritance_level: number;
}

export interface ChoiceInfo {
  sys_id: string;
  element: string;
  value: string;
  label: string;
  sequence: number;
}

export interface StateItem {
  sys_id: string;
  table_id?: string;
  table_name?: string;
  name: string;
  label: string;
  sequence: number;
  is_active: boolean;
  color: string;
  description?: string;
}

export interface TransitionInfo {
  transition_id: string;
  from_state_id?: string;
  from_state: string;
  from_state_label?: string;
  to_state_id?: string;
  to_state: string;
  to_state_label?: string;
  label: string;
  action_name: string;
  defined_in_table: string;
  requires_fields?: string[];
  button_variant?: string;
}

export interface AuditEntry {
  sys_id: string;
  table_name: string;
  operation: string;
  field_name: string;
  old_value: any;
  new_value: any;
  changed_on: string;
  changed_by: {
    sys_id: string;
    user_name: string;
    first_name?: string;
    last_name?: string;
  };
}

export interface ListResponse<T> {
  meta: {
    table: string;
    total_count: number;
    limit: number;
    offset: number;
  };
  data: T[];
}

// Token storage helpers
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('tableengine_token');
}

export function setToken(token: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('tableengine_token', token);
  }
}

export function removeToken(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('tableengine_token');
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (res.status === 204) {
    return {} as T;
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errorMsg = data?.error?.message || `HTTP ${res.status}: ${res.statusText}`;
    throw new Error(errorMsg);
  }

  return data as T;
}

export const api = {
  auth: {
    login: (user_name: string, password: string) =>
      request<{ token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ user_name, password }),
      }),
    me: () => request<User>('/auth/me'),
  },

  schema: {
    listTables: (includeKernel = false) =>
      request<TableInfo[]>(`/schema/tables?include_kernel=${includeKernel}`),
    getTable: (idOrName: string) =>
      request<TableInfo>(`/schema/tables/${idOrName}`),
    createTable: (payload: { name: string; label: string; super_class_id?: string | null; is_extendable?: boolean }) =>
      request<TableInfo>('/schema/tables', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    updateTable: (id: string, payload: { label?: string; is_extendable?: boolean }) =>
      request<TableInfo>(`/schema/tables/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    deleteTable: (id: string) =>
      request<void>(`/schema/tables/${id}`, {
        method: 'DELETE',
      }),
    getFields: (tableName: string) =>
      request<FieldInfo[]>(`/schema/tables/${tableName}/fields`),
    getField: (fieldId: string) =>
      request<FieldInfo>(`/schema/fields/${fieldId}`),
    addField: (
      tableId: string,
      payload: {
        column_name: string;
        label: string;
        internal_type: string;
        max_length?: number;
        is_mandatory?: boolean;
        is_read_only?: boolean;
        default_value?: string;
        reference_table_id?: string;
        number_prefix?: string;
        minimum_digits?: number;
        start_number?: number;
      }
    ) =>
      request<FieldInfo>(`/schema/tables/${tableId}/fields`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    updateField: (fieldId: string, payload: { label?: string; is_mandatory?: boolean; is_read_only?: boolean; default_value?: string | null }) =>
      request<FieldInfo>(`/schema/fields/${fieldId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    deleteField: (fieldId: string) =>
      request<void>(`/schema/fields/${fieldId}`, {
        method: 'DELETE',
      }),
    getChoices: (tableName: string, element: string) =>
      request<ChoiceInfo[]>(`/schema/choices/${tableName}/${element}`),
    getTableChoices: (tableName: string) =>
      request<ChoiceInfo[]>(`/schema/tables/${tableName}/choices`),
    getChoice: (choiceId: string) =>
      request<ChoiceInfo>(`/schema/choices/${choiceId}`),
    addChoice: (payload: { table_id: string; element: string; value: string; label: string; sequence?: number }) =>
      request<{ sys_id: string }>('/schema/choices', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    updateChoice: (choiceId: string, payload: { label?: string; value?: string; sequence?: number; is_active?: boolean }) =>
      request<ChoiceInfo>(`/schema/choices/${choiceId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    deleteChoice: (choiceId: string) =>
      request<void>(`/schema/choices/${choiceId}`, {
        method: 'DELETE',
      }),
    configureNumber: (payload: { table_id: string; field_name?: string; prefix: string; minimum_digits?: number; start_number?: number }) =>
      request<any>('/schema/numbers', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  },

  records: {
    list: (tableName: string, params?: { limit?: number; offset?: number; sort_by?: string; sort_dir?: string; query?: string }) => {
      const sp = new URLSearchParams();
      if (params?.limit) sp.set('limit', String(params.limit));
      if (params?.offset) sp.set('offset', String(params.offset));
      if (params?.sort_by) sp.set('sort_by', params.sort_by);
      if (params?.sort_dir) sp.set('sort_dir', params.sort_dir);
      if (params?.query) sp.set('query', params.query);
      return request<ListResponse<any>>(`/records/${tableName}?${sp.toString()}`);
    },
    get: (tableName: string, id: string) =>
      request<any>(`/records/${tableName}/${id}`),
    create: (tableName: string, payload: Record<string, any>) =>
      request<any>(`/records/${tableName}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    update: (tableName: string, id: string, payload: Record<string, any>) =>
      request<any>(`/records/${tableName}/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    delete: (tableName: string, id: string) =>
      request<void>(`/records/${tableName}/${id}`, {
        method: 'DELETE',
      }),
    availableTransitions: (tableName: string, id: string) =>
      request<TransitionInfo[]>(`/records/${tableName}/${id}/available-transitions`),
    executeTransition: (tableName: string, id: string, transitionId: string, payload: { sys_mod_count?: any; payload?: any }) =>
      request<any>(`/records/${tableName}/${id}/transitions/${transitionId}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    audit: (tableName: string, id: string) =>
      request<AuditEntry[]>(`/records/${tableName}/${id}/audit`),
  },

  fsm: {
    listStates: (tableId?: string) =>
      request<StateItem[]>(tableId ? `/fsm/states?table_id=${tableId}` : '/fsm/states'),
    getState: (id: string) => request<StateItem>(`/fsm/states/${id}`),
    createState: (payload: Partial<StateItem>) =>
      request<StateItem>('/fsm/states', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    updateState: (id: string, payload: Partial<StateItem>) =>
      request<StateItem>(`/fsm/states/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    deleteState: (id: string) =>
      request<void>(`/fsm/states/${id}`, {
        method: 'DELETE',
      }),
    listTransitions: () => request<any[]>('/fsm/transitions'),
    getTransition: (id: string) => request<any>(`/fsm/transitions/${id}`),
    createTransition: (payload: any) =>
      request<{ sys_id: string }>('/fsm/transitions', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    updateTransition: (id: string, payload: any) =>
      request<any>(`/fsm/transitions/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    deleteTransition: (id: string) =>
      request<void>(`/fsm/transitions/${id}`, {
        method: 'DELETE',
      }),
  },

  rules: {
    listRules: () => request<any[]>('/rules/scripts'),
    getRule: (id: string) => request<any>(`/rules/scripts/${id}`),
    createRule: (payload: any) =>
      request<{ sys_id: string }>('/rules/scripts', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    updateRule: (id: string, payload: any) =>
      request<any>(`/rules/scripts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    deleteRule: (id: string) =>
      request<void>(`/rules/scripts/${id}`, {
        method: 'DELETE',
      }),
  },

  rbac: {
    users: {
      list: () => request<any[]>('/rbac/users'),
      get: (id: string) => request<any>(`/rbac/users/${id}`),
      create: (payload: any) =>
        request<{ sys_id: string }>('/rbac/users', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      update: (id: string, payload: any) =>
        request<any>(`/rbac/users/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        }),
      delete: (id: string) =>
        request<void>(`/rbac/users/${id}`, {
          method: 'DELETE',
        }),
    },
    groups: {
      list: () => request<any[]>('/rbac/groups'),
      get: (id: string) => request<any>(`/rbac/groups/${id}`),
      create: (payload: any) =>
        request<{ sys_id: string }>('/rbac/groups', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      update: (id: string, payload: any) =>
        request<any>(`/rbac/groups/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        }),
      delete: (id: string) =>
        request<void>(`/rbac/groups/${id}`, {
          method: 'DELETE',
        }),
    },
    roles: {
      list: () => request<any[]>('/rbac/roles'),
      get: (id: string) => request<any>(`/rbac/roles/${id}`),
      create: (payload: any) =>
        request<{ sys_id: string }>('/rbac/roles', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      update: (id: string, payload: any) =>
        request<any>(`/rbac/roles/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        }),
      delete: (id: string) =>
        request<void>(`/rbac/roles/${id}`, {
          method: 'DELETE',
        }),
    },
    permissions: {
      list: () => request<any[]>('/rbac/permissions'),
      get: (id: string) => request<any>(`/rbac/permissions/${id}`),
      create: (payload: any) =>
        request<{ sys_id: string }>('/rbac/permissions', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      update: (id: string, payload: any) =>
        request<any>(`/rbac/permissions/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        }),
      delete: (id: string) =>
        request<void>(`/rbac/permissions/${id}`, {
          method: 'DELETE',
        }),
    },
  },
};

