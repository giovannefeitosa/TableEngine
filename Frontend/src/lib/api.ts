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

export interface TransitionInfo {
  transition_id: string;
  from_state: string;
  to_state: string;
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
    createTable: (payload: { name: string; label: string; super_class_id?: string | null; is_extendable?: boolean }) =>
      request<TableInfo>('/schema/tables', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    getFields: (tableName: string) =>
      request<FieldInfo[]>(`/schema/tables/${tableName}/fields`),
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
    getChoices: (tableName: string, element: string) =>
      request<ChoiceInfo[]>(`/schema/choices/${tableName}/${element}`),
    addChoice: (payload: { table_id: string; element: string; value: string; label: string; sequence?: number }) =>
      request<{ sys_id: string }>('/schema/choices', {
        method: 'POST',
        body: JSON.stringify(payload),
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
    listTransitions: () => request<any[]>('/fsm/transitions'),
    createTransition: (payload: any) =>
      request<{ sys_id: string }>('/fsm/transitions', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  },

  rules: {
    listRules: () => request<any[]>('/rules/scripts'),
    createRule: (payload: any) =>
      request<{ sys_id: string }>('/rules/scripts', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  },
};
