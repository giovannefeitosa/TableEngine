# End-to-End System Verification for TableEngine v2
$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "TableEngine v2 - Complete Verification" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Health & Frontend
Write-Host "`n1. Verificando Health e Frontend..." -ForegroundColor Yellow
$health = Invoke-RestMethod -Uri "http://localhost:8080/health"
Write-Host "  Backend Health: $($health.status) ($($health.engine))" -ForegroundColor Green

$fe = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing
Write-Host "  Frontend HTTP Status: $($fe.StatusCode)" -ForegroundColor Green

# 2. Login
Write-Host "`n2. Autenticando com 'admin'..." -ForegroundColor Yellow
$loginPayload = @{
    user_name = "admin"
    password = "Admin123!Safe"
} | ConvertTo-Json

$loginRes = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/auth/login" -Method Post -Body $loginPayload -ContentType "application/json"
$token = $loginRes.token
$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}
Write-Host "  Login OK. Token recebido para usuário: $($loginRes.user.user_name)" -ForegroundColor Green

# 3. Schema Studio CRUD (Tables, Fields, Choices)
Write-Host "`n3. Testando CRUD completo de Schema (Tabela, Campos, Opções)..." -ForegroundColor Yellow

# 3.0 Clean up any previous test table
$existingTables = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/schema/tables" -Method Get -Headers $headers
$prevTable = $existingTables | Where-Object { $_.name -eq "tbl_test_suite" }
if ($prevTable) {
    Write-Host "  Limpando tabela pré-existente: $($prevTable.sys_id)..." -ForegroundColor Gray
    Invoke-RestMethod -Uri "http://localhost:8080/api/v1/schema/tables/$($prevTable.sys_id)" -Method Delete -Headers $headers
}

# 3.1 Create Table
$tablePayload = @{
    name = "tbl_test_suite"
    label = "Tabela de Teste Automatizado"
    is_extendable = $true
} | ConvertTo-Json
$createdTable = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/schema/tables" -Method Post -Body $tablePayload -Headers $headers
$tableId = $createdTable.sys_id
Write-Host "  [OK] Criada tabela: $($createdTable.name) (sys_id: $tableId)" -ForegroundColor Green

# 3.2 Get Table
$gotTable = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/schema/tables/$tableId" -Method Get -Headers $headers
Write-Host "  [OK] Lido detalhes da tabela: $($gotTable.label)" -ForegroundColor Green

# 3.3 Update Table (In-place edit)
$updateTablePayload = @{
    label = "Tabela de Teste Atualizada"
    is_extendable = $true
} | ConvertTo-Json
$updatedTable = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/schema/tables/$tableId" -Method Put -Body $updateTablePayload -Headers $headers
Write-Host "  [OK] Atualizada tabela: $($updatedTable.label)" -ForegroundColor Green

# 3.4 Add Field
$fieldPayload = @{
    column_name = "test_status"
    label = "Status do Teste"
    internal_type = "string"
    is_mandatory = $false
    is_read_only = $false
} | ConvertTo-Json
$createdField = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/schema/tables/$tableId/fields" -Method Post -Body $fieldPayload -Headers $headers
$fieldId = $createdField.sys_id
Write-Host "  [OK] Criado campo: $($createdField.column_name) (sys_id: $fieldId)" -ForegroundColor Green

# 3.5 Get Field
$gotField = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/schema/fields/$fieldId" -Method Get -Headers $headers
Write-Host "  [OK] Lido detalhes do campo: $($gotField.label)" -ForegroundColor Green

# 3.6 Update Field
$updateFieldPayload = @{
    label = "Status do Teste Renomeado"
    is_mandatory = $true
    is_read_only = $false
} | ConvertTo-Json
$updatedField = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/schema/fields/$fieldId" -Method Put -Body $updateFieldPayload -Headers $headers
Write-Host "  [OK] Atualizado campo: $($updatedField.label), obrigatório: $($updatedField.is_mandatory)" -ForegroundColor Green

# 3.7 Add Choice
$choicePayload = @{
    table_id = $tableId
    element = "test_status"
    value = "val_ok"
    label = "Valor OK"
    sequence = 10
} | ConvertTo-Json
$createdChoice = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/schema/choices" -Method Post -Body $choicePayload -Headers $headers
$choiceId = $createdChoice.sys_id
Write-Host "  [OK] Criada opção de dropdown: $choiceId" -ForegroundColor Green

# 3.8 Get Table Choices
$tableChoices = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/schema/tables/tbl_test_suite/choices" -Method Get -Headers $headers
Write-Host "  [OK] Listadas opções da tabela: $($tableChoices.Count) opções encontradas" -ForegroundColor Green

# 3.9 Update Choice
$updateChoicePayload = @{
    label = "Valor OK Atualizado"
    value = "val_ok"
    sequence = 20
    is_active = $true
} | ConvertTo-Json
$updatedChoice = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/schema/choices/$choiceId" -Method Put -Body $updateChoicePayload -Headers $headers
Write-Host "  [OK] Atualizada opção: $($updatedChoice.label) (seq: $($updatedChoice.sequence))" -ForegroundColor Green

# 3.10 Delete Choice
Invoke-RestMethod -Uri "http://localhost:8080/api/v1/schema/choices/$choiceId" -Method Delete -Headers $headers
Write-Host "  [OK] Excluída opção de dropdown" -ForegroundColor Green

# 3.11 Delete Field
Invoke-RestMethod -Uri "http://localhost:8080/api/v1/schema/fields/$fieldId" -Method Delete -Headers $headers
Write-Host "  [OK] Excluído campo da tabela (coluna descartada no PG)" -ForegroundColor Green

# 3.12 Delete Table
Invoke-RestMethod -Uri "http://localhost:8080/api/v1/schema/tables/$tableId" -Method Delete -Headers $headers
Write-Host "  [OK] Excluída tabela inteira no PostgreSQL" -ForegroundColor Green

# 4. FSM Transitions CRUD
Write-Host "`n4. Testando CRUD completo de FSM (Transições de Estado)..." -ForegroundColor Yellow
$tablesList = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/schema/tables" -Method Get -Headers $headers
$targetTable = $tablesList | Where-Object { -not $_.is_kernel_table } | Select-Object -First 1
if (-not $targetTable) {
    $targetTable = $tablesList | Select-Object -First 1
}

# Cleanup previous transitions
$existingTrans = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/fsm/transitions" -Method Get -Headers $headers
foreach ($t in $existingTrans) {
    if ($t.from_state -eq "draft" -and $t.to_state -eq "review") {
        Invoke-RestMethod -Uri "http://localhost:8080/api/v1/fsm/transitions/$($t.sys_id)" -Method Delete -Headers $headers
    }
}

$transPayload = @{
    table_id = $targetTable.sys_id
    from_state = "draft"
    to_state = "review"
    action_name = "btn_submit_review"
    label = "Enviar para Revisão"
    roles = @("admin")
    button_variant = "primary"
} | ConvertTo-Json
$createdTrans = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/fsm/transitions" -Method Post -Body $transPayload -Headers $headers
$transId = $createdTrans.sys_id
Write-Host "  [OK] Criada transição: $($createdTrans.label) (sys_id: $transId)" -ForegroundColor Green

$gotTrans = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/fsm/transitions/$transId" -Method Get -Headers $headers
Write-Host "  [OK] Lido detalhes da transição: $($gotTrans.label)" -ForegroundColor Green

$updateTransPayload = @{
    label = "Submeter à Revisão (Atualizado)"
    button_variant = "warning"
    roles = @("admin")
} | ConvertTo-Json
$updatedTrans = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/fsm/transitions/$transId" -Method Put -Body $updateTransPayload -Headers $headers
Write-Host "  [OK] Atualizada transição: $($updatedTrans.message)" -ForegroundColor Green

Invoke-RestMethod -Uri "http://localhost:8080/api/v1/fsm/transitions/$transId" -Method Delete -Headers $headers
Write-Host "  [OK] Excluída transição" -ForegroundColor Green

# 5. Business Rules CRUD
Write-Host "`n5. Testando CRUD completo de Regras de Negócio (sys_script)..." -ForegroundColor Yellow

# Cleanup previous test rules
$existingRules = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rules/scripts" -Method Get -Headers $headers
foreach ($r in $existingRules) {
    if ($r.name -like "Regra de Teste*") {
        Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rules/scripts/$($r.sys_id)" -Method Delete -Headers $headers
    }
}

$rulePayload = @{
    name = "Regra de Teste Automatizado"
    table_id = $targetTable.sys_id
    timing = "before_insert"
    execution_order = 100
    execution_mode = "caller"
    action_type = "set_field_value"
    condition_expression = @{
        description = "Validação automática"
        conditions = @()
    }
    action_payload = @{
        field = "short_description"
        value = "Default Description"
    }
    is_active = $true
} | ConvertTo-Json -Depth 5
$createdRule = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rules/scripts" -Method Post -Body $rulePayload -Headers $headers
$ruleId = $createdRule.sys_id
Write-Host "  [OK] Criada regra de negócio: $($rulePayload.name) (sys_id: $ruleId)" -ForegroundColor Green

$gotRule = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rules/scripts/$ruleId" -Method Get -Headers $headers
Write-Host "  [OK] Lido detalhes da regra: $($gotRule.name)" -ForegroundColor Green

$updateRulePayload = @{
    name = "Regra de Teste (Nome Atualizado)"
    order = 200
    is_active = $true
} | ConvertTo-Json
$updatedRule = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rules/scripts/$ruleId" -Method Put -Body $updateRulePayload -Headers $headers
Write-Host "  [OK] Atualizada regra: $($updatedRule.message)" -ForegroundColor Green

Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rules/scripts/$ruleId" -Method Delete -Headers $headers
Write-Host "  [OK] Excluída regra de negócio" -ForegroundColor Green

# 6. RBAC CRUD (Users, Groups, Roles, Permissions)
Write-Host "`n6. Testando CRUD completo de RBAC..." -ForegroundColor Yellow

# RBAC Cleanup
$existingUsers = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rbac/users" -Method Get -Headers $headers
foreach ($u in $existingUsers) {
    if ($u.user_name -eq "test.qa.user") {
        Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rbac/users/$($u.sys_id)" -Method Delete -Headers $headers
    }
}
$existingGroups = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rbac/groups" -Method Get -Headers $headers
foreach ($g in $existingGroups) {
    if ($g.name -eq "Grupo de Teste QA") {
        Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rbac/groups/$($g.sys_id)" -Method Delete -Headers $headers
    }
}
$existingRoles = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rbac/roles" -Method Get -Headers $headers
foreach ($r in $existingRoles) {
    if ($r.name -eq "test_qa_role") {
        Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rbac/roles/$($r.sys_id)" -Method Delete -Headers $headers
    }
}
$existingPerms = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rbac/permissions" -Method Get -Headers $headers
foreach ($p in $existingPerms) {
    if ($p.name -eq "test.qa.permission") {
        Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rbac/permissions/$($p.sys_id)" -Method Delete -Headers $headers
    }
}

# 6.1 Role CRUD
$rolePayload = @{
    name = "test_qa_role"
    description = "Papel para testes de automação"
    is_active = $true
} | ConvertTo-Json
$createdRole = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rbac/roles" -Method Post -Body $rolePayload -Headers $headers
$roleId = $createdRole.sys_id
Write-Host "  [OK] Criado Role: $($createdRole.name) (sys_id: $roleId)" -ForegroundColor Green

$gotRole = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rbac/roles/$roleId" -Method Get -Headers $headers
Write-Host "  [OK] Lido detalhes do Role: $($gotRole.name)" -ForegroundColor Green

$updateRolePayload = @{
    description = "Papel atualizado com sucesso"
    is_active = $true
} | ConvertTo-Json
$updatedRole = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rbac/roles/$roleId" -Method Put -Body $updateRolePayload -Headers $headers
Write-Host "  [OK] Atualizado Role: $($updatedRole.description)" -ForegroundColor Green

# 6.2 Group CRUD
$groupPayload = @{
    name = "Grupo de Teste QA"
    description = "Grupo temporário para testes"
    is_active = $true
    role_ids = @($roleId)
} | ConvertTo-Json
$createdGroup = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rbac/groups" -Method Post -Body $groupPayload -Headers $headers
$groupId = $createdGroup.sys_id
Write-Host "  [OK] Criado Grupo: $($createdGroup.name) (sys_id: $groupId)" -ForegroundColor Green

$gotGroup = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rbac/groups/$groupId" -Method Get -Headers $headers
Write-Host "  [OK] Lido detalhes do Grupo: $($gotGroup.name), roles associadas: $($gotGroup.roles.Count)" -ForegroundColor Green

$updateGroupPayload = @{
    description = "Descrição do grupo alterada"
    is_active = $true
} | ConvertTo-Json
$updatedGroup = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rbac/groups/$groupId" -Method Put -Body $updateGroupPayload -Headers $headers
Write-Host "  [OK] Atualizado Grupo: $($updatedGroup.description)" -ForegroundColor Green

# 6.3 User CRUD
$userPayload = @{
    user_name = "test.qa.user"
    password = "SafePassword999!"
    first_name = "Usuário"
    last_name = "QA"
    email = "qa.user@empresa.com"
    is_active = $true
    group_ids = @($groupId)
} | ConvertTo-Json
$createdUser = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rbac/users" -Method Post -Body $userPayload -Headers $headers
$userId = $createdUser.sys_id
Write-Host "  [OK] Criado Usuário: $($createdUser.user_name) (sys_id: $userId)" -ForegroundColor Green

$gotUser = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rbac/users/$userId" -Method Get -Headers $headers
Write-Host "  [OK] Lido detalhes do Usuário: $($gotUser.first_name) $($gotUser.last_name), grupos: $($gotUser.groups.Count)" -ForegroundColor Green

$updateUserPayload = @{
    first_name = "Usuário Alterado"
    last_name = "QA Master"
    is_active = $true
    group_ids = @($groupId)
} | ConvertTo-Json
$updatedUser = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rbac/users/$userId" -Method Put -Body $updateUserPayload -Headers $headers
Write-Host "  [OK] Atualizado Usuário: $($updatedUser.first_name) $($updatedUser.last_name)" -ForegroundColor Green

# 6.4 Permission CRUD
$permPayload = @{
    name = "test.qa.permission"
    description = "Permissão de teste de QA"
    table_id = $targetTable.sys_id
    operation = "read"
    type = "table"
} | ConvertTo-Json
$createdPerm = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rbac/permissions" -Method Post -Body $permPayload -Headers $headers
$permId = $createdPerm.sys_id
Write-Host "  [OK] Criada Permissão: $($permPayload.name) (sys_id: $permId)" -ForegroundColor Green

$gotPerm = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rbac/permissions/$permId" -Method Get -Headers $headers
Write-Host "  [OK] Lido detalhes da Permissão: $($gotPerm.name)" -ForegroundColor Green

$updatePermPayload = @{
    description = "Descrição atualizada da permissão"
    table_id = $targetTable.sys_id
    operation = "update"
    type = "table"
} | ConvertTo-Json
$updatedPerm = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rbac/permissions/$permId" -Method Put -Body $updatePermPayload -Headers $headers
Write-Host "  [OK] Atualizada Permissão: $($updatedPerm.name)" -ForegroundColor Green

# Cleanup RBAC
Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rbac/users/$userId" -Method Delete -Headers $headers
Write-Host "  [OK] Excluído Usuário" -ForegroundColor Green

Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rbac/groups/$groupId" -Method Delete -Headers $headers
Write-Host "  [OK] Excluído Grupo" -ForegroundColor Green

Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rbac/roles/$roleId" -Method Delete -Headers $headers
Write-Host "  [OK] Excluído Role" -ForegroundColor Green

Invoke-RestMethod -Uri "http://localhost:8080/api/v1/rbac/permissions/$permId" -Method Delete -Headers $headers
Write-Host "  [OK] Excluída Permissão" -ForegroundColor Green

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host " TODOS OS TESTES PASSARAM COM SUCESSO! 100% OPERACIONAL" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Cyan
