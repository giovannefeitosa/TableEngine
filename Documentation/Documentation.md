# **Especificação Arquitetural: Engine de Metadados e Herança Dinâmica (Versão 2\)**

**Plataforma Application Platform as a Service (aPaaS) orientada a Metadados sobre PostgreSQL**

## **1\. Visão Geral e Princípios Fundamentais**

Esta arquitetura define a construção de um motor de dados dinâmico inspirado nos modelos de engenharia do **ServiceNow** e da infraestrutura de metadados multitenant do **Salesforce (Force.com)**.

### **1.1 Premissas da Versão 2**

* **Zero Tabelas de Negócio no Código/Migrações Estáticas: Nenhuma tabela de domínio (task, incident, problem, change\_request ou cmdb\_ci) vem pré-criada. A instalação cria o Kernel de metadados, identidade, autorização, auditoria, regras, transições e numeração. As entidades de negócio são criadas depois pela interface ou API autorizada.**  
* **Criação de Tabelas Raiz e Filhas pela Interface: Usuários com permissão explícita criam tabelas raiz, campos e tabelas filhas pela UI/API. Alterar estruturas sys\_\* ou políticas de segurança exige permissões administrativas próprias; ser usuário final ou possuir uma role sem a permissão correspondente não autoriza DDL.**  
* **Estratégia de Persistência Escolhida:** **Dynamic Table-per-Type (TPT)**. Cada nível da hierarquia possui sua própria tabela física no PostgreSQL, mantendo integridade referencial estrita, tipagem forte e normalização eficiente.  
* **Governança de Ciclo de Vida por Transições:** O avanço de registros por diferentes fases operacionais (ex.: *Novo* $\rightarrow$ *Em Andamento* $\rightarrow$ *Resolvido*) é estritamente controlado por uma Máquina de Estados Finita (FSM) declarativa baseada em papéis e condições.  
* Identificadores: toda chave técnica e toda referência entre registros usa UUID v4 em sys\_id/FKs. Referências a usuários armazenam exclusivamente sys\_user.sys\_id; e-mail e user\_name são atributos de exibição/autenticação. Contadores e quantidades podem ser BIGINT, mas nunca substituem a chave UUID.  
* Numeração legível: a plataforma disponibiliza sys\_number e sys\_number\_counter desde a instalação. Qualquer entidade pode receber pela interface um campo number com prefixo de 1 a 3 caracteres e sequência, como TSK0000001. A tabela task continua sendo criada apenas quando solicitada pelo usuário.  
* Autorização: Usuário → Grupos → Roles → Permissões, conforme a seção 11\. Toda operação é negada sem concessão aplicável. Não há cache de metadados, permissões ou numeração nesta fase; a engine consulta o PostgreSQL a cada operação.

## **2\. Catálogo do Kernel de Metadados (Data Dictionary)**

A instalação cria exclusivamente as estruturas do Kernel: os catálogos abaixo, as entidades de identidade/autorização e numeração das subseções 2.1–2.3, além de sys\_audit, sys\_script e sys\_state\_transition, detalhadas nas seções 7–9. Todas são registradas em sys\_db\_object com is\_kernel\_table \= TRUE e têm seus campos registrados em sys\_dictionary; nenhuma tabela de negócio é instalada por padrão.

\-- Extensão para geração de chaves primárias universais UUID v4

CREATE EXTENSION IF NOT EXISTS pgcrypto;

\-- 1\. Catálogo de Classes/Tabelas

CREATE TABLE sys\_db\_object (

    sys\_id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),

    name VARCHAR(80) NOT NULL UNIQUE,              \-- Nome físico no PostgreSQL (ex: 'tbl\_task', 'tbl\_incident')

    label VARCHAR(100) NOT NULL,                  \-- Nome amigável de exibição (ex: 'Tarefa', 'Incidente')

    super\_class\_id UUID REFERENCES sys\_db\_object(sys\_id) ON DELETE RESTRICT, \-- Auto-relacionamento (tabela pai)

    is\_extendable BOOLEAN DEFAULT TRUE,           \-- Define se permite herança

    is\_kernel\_table BOOLEAN DEFAULT FALSE,        \-- True para tabelas do sistema (sys\_\*), False para tabelas de negócio

    sys\_created\_on TIMESTAMPTZ DEFAULT clock\_timestamp()

);

\-- 2\. Dicionário de Campos (Atributos)

CREATE TABLE sys\_dictionary (

    sys\_id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),

    table\_id UUID NOT NULL REFERENCES sys\_db\_object(sys\_id) ON DELETE CASCADE,

    column\_name VARCHAR(80) NOT NULL,              \-- Nome físico da coluna

    label VARCHAR(100) NOT NULL,                  \-- Rótulo do campo no formulário

    internal\_type VARCHAR(40) NOT NULL, \-- uuid, string, integer, bigint, boolean, reference, text, jsonb, timestamptz, auto\_number

    max\_length INTEGER DEFAULT 255,

    is\_mandatory BOOLEAN DEFAULT FALSE,           \-- Campo obrigatório?

    is\_read\_only BOOLEAN DEFAULT FALSE,           \-- Campo somente-leitura?

    default\_value TEXT,                           \-- Valor padrão em formato string ou expressão

    reference\_table\_id UUID REFERENCES sys\_db\_object(sys\_id), \-- Se for 'reference', para qual tabela aponta

    is\_system\_field BOOLEAN DEFAULT FALSE,         \-- True se for atributo do kernel (sys\_id, sys\_class\_name, etc.)

    sys\_created\_on TIMESTAMPTZ DEFAULT clock\_timestamp(),

    UNIQUE (table\_id, column\_name)

);

\-- 3\. Lista de Opções (Choice Lists / Dropdowns)

CREATE TABLE sys\_choice (

    sys\_id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),

    table\_id UUID NOT NULL REFERENCES sys\_db\_object(sys\_id) ON DELETE CASCADE,

    element VARCHAR(80) NOT NULL,                 \-- Nome da coluna referenciada (ex: 'state')

    value VARCHAR(100) NOT NULL,                  \-- Valor técnico gravado no banco (ex: '1', '2' ou 'draft', 'resolved')

    label VARCHAR(100) NOT NULL,                  \-- Texto exibido ao usuário (ex: 'Em Andamento')

    sequence INTEGER DEFAULT 0,                   \-- Ordem de exibição na interface

    is\_active BOOLEAN DEFAULT TRUE,

    dependent\_value VARCHAR(100),                 \-- Para dropdowns encadeados

    sys\_created\_on TIMESTAMPTZ DEFAULT clock\_timestamp(),

    UNIQUE (table\_id, element, value)

);

### **2.1 Identidade e Autorização no Kernel**

UUID v4 é o padrão único de chaves do sistema, gerado por gen\_random\_uuid(). Os DDLs abaixo definem os campos específicos; o passo comum de bootstrap da seção 2.3 acrescenta os campos de autoria, datas e versão às tabelas do Kernel. Nome e e-mail nunca são chaves de referência para usuários.

CREATE TABLE sys\_user (  
    sys\_id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
    user\_name VARCHAR(100) NOT NULL UNIQUE,  
    first\_name VARCHAR(100) NOT NULL,  
    last\_name VARCHAR(100),  
    email VARCHAR(254),  
    phone VARCHAR(40),  
    job\_title VARCHAR(120),  
    department VARCHAR(120),  
    company VARCHAR(120),  
    manager\_id UUID REFERENCES sys\_user(sys\_id) ON DELETE RESTRICT,  
    locale VARCHAR(20),  
    time\_zone VARCHAR(80),  
    is\_service\_account BOOLEAN NOT NULL DEFAULT FALSE,  
    is\_active BOOLEAN NOT NULL DEFAULT FALSE  
);  
CREATE TABLE sys\_user\_group (  
    sys\_id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
    name VARCHAR(100) NOT NULL UNIQUE,  
    description TEXT,  
    manager\_id UUID REFERENCES sys\_user(sys\_id) ON DELETE RESTRICT,  
    is\_active BOOLEAN NOT NULL DEFAULT TRUE  
);  
CREATE TABLE sys\_user\_role (  
    sys\_id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
    name VARCHAR(100) NOT NULL UNIQUE,  
    description TEXT,  
    is\_active BOOLEAN NOT NULL DEFAULT TRUE  
);  
CREATE TABLE sys\_permission (  
    sys\_id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
    name VARCHAR(160) NOT NULL UNIQUE,  
    description TEXT,  
    table\_id UUID NOT NULL REFERENCES sys\_db\_object(sys\_id) ON DELETE RESTRICT,  
    operation VARCHAR(10) NOT NULL  
        CHECK (operation IN ('create','read','update','delete','execute')),  
    field\_name VARCHAR(80),  
    action\_name VARCHAR(100),  
    condition\_tree JSONB,  
    is\_active BOOLEAN NOT NULL DEFAULT TRUE,  
    CHECK (field\_name IS NULL OR operation IN ('create','read','update')),  
    CHECK ((operation \= 'execute' AND action\_name IS NOT NULL AND field\_name IS NULL)  
        OR (operation \<\> 'execute' AND action\_name IS NULL))  
);  
CREATE TABLE sys\_user\_grmember (  
    sys\_id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
    user\_id UUID NOT NULL REFERENCES sys\_user(sys\_id) ON DELETE RESTRICT,  
    group\_id UUID NOT NULL REFERENCES sys\_user\_group(sys\_id) ON DELETE RESTRICT,  
    UNIQUE (user\_id, group\_id)  
);  
CREATE TABLE sys\_group\_has\_role (  
    sys\_id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
    group\_id UUID NOT NULL REFERENCES sys\_user\_group(sys\_id) ON DELETE RESTRICT,  
    role\_id UUID NOT NULL REFERENCES sys\_user\_role(sys\_id) ON DELETE RESTRICT,  
    UNIQUE (group\_id, role\_id)  
);  
CREATE TABLE sys\_role\_has\_permission (  
    sys\_id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
    role\_id UUID NOT NULL REFERENCES sys\_user\_role(sys\_id) ON DELETE RESTRICT,  
    permission\_id UUID NOT NULL REFERENCES sys\_permission(sys\_id) ON DELETE RESTRICT,  
    UNIQUE (role\_id, permission\_id)  
);  
CREATE INDEX idx\_grmember\_group ON sys\_user\_grmember(group\_id, user\_id);  
CREATE INDEX idx\_group\_role\_role ON sys\_group\_has\_role(role\_id, group\_id);  
CREATE INDEX idx\_role\_permission\_permission ON sys\_role\_has\_permission(permission\_id, role\_id);  
CREATE INDEX idx\_permission\_resource ON sys\_permission(table\_id, operation)  
    WHERE is\_active \= TRUE;

A configuração de uma permissão valida field\_name contra o dicionário efetivo da tabela, inclusive campos herdados. action\_name identifica uma ação registrada da engine, como create\_table, add\_field ou transition:in\_progress:resolved. Não se aceitam condições ou identificadores SQL arbitrários vindos do cliente; condition\_tree usa operadores permitidos e parâmetros. Os nomes servem para exibição/busca; os vínculos usam UUID.

### **2.2 Catálogo de Numeração Reutilizável**

sys\_number e sys\_number\_counter são a estrutura de numeração disponível automaticamente no banco, inspirada em Number Maintenance do ServiceNow. Ela fornece o identificador legível number; a identidade técnica de cada registro permanece em sys\_id UUID. BIGINT aparece apenas como valor do contador e do número inicial.

CREATE TABLE sys\_number (  
    sys\_id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
    table\_id UUID NOT NULL REFERENCES sys\_db\_object(sys\_id) ON DELETE RESTRICT,  
    field\_name VARCHAR(80) NOT NULL DEFAULT 'number',  
    prefix VARCHAR(3) NOT NULL UNIQUE,  
    minimum\_digits SMALLINT NOT NULL DEFAULT 7 CHECK (minimum\_digits BETWEEN 1 AND 19),  
    start\_number BIGINT NOT NULL DEFAULT 1 CHECK (start\_number \>= 1),  
    is\_active BOOLEAN NOT NULL DEFAULT TRUE,  
    CHECK (char\_length(prefix) BETWEEN 1 AND 3 AND prefix \= upper(btrim(prefix))),  
    UNIQUE (table\_id, field\_name)  
);  
CREATE TABLE sys\_number\_counter (  
    sys\_id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
    number\_id UUID NOT NULL UNIQUE REFERENCES sys\_number(sys\_id) ON DELETE RESTRICT,  
    last\_value BIGINT NOT NULL CHECK (last\_value \>= 0\)  
);

Cada configuração atende a uma tabela/campo e recebe prefixo obrigatório de até 3 caracteres, normalizado para maiúsculas, mais uma largura mínima de dígitos. O prefixo é único entre configurações para evitar códigos iguais em entidades diferentes. Ao criar a configuração, o backend cria seu contador com last\_value \= start\_number \- 1 na mesma transação. Não há reserva de faixas, cache ou cálculo por MAX(number).

Após emitir o primeiro número, prefixo e número inicial ficam imutáveis; o contador nunca é reduzido ou reiniciado. Configurações usadas são desativadas, não apagadas, e seus prefixos não são reutilizados. A largura mínima só pode aumentar. O número final é imutável e protegido por UNIQUE na tabela física que armazena o campo.

Referência conceitual: [ServiceNow — Record numbering](https://www.servicenow.com/docs/r/platform-administration/c_ManagingRecordNumbering.html) e [Add auto-numbering records in a table](https://www.servicenow.com/docs/r/platform-administration/t_AutoNumberingRecordsInATable.html). A limitação de 3 caracteres e o uso de UUID são decisões desta plataforma.

### **2.3 Bootstrap, Autoria e Administração Inicial**

O bootstrap cria primeiro sys\_db\_object, sys\_dictionary e sys\_choice; depois identidade, vínculos e numeração; por fim auditoria, regras e transições. Registra os catálogos sys\_\* e seus campos, sem criar task ou qualquer domínio. Identificadores reservados usados nos exemplos são ilustrativos; a instalação deve persistir e reutilizar os UUIDs efetivamente criados.

Na transação inicial, criar um usuário técnico de instalação e o primeiro administrador, ainda inativos; criar seus grupos, roles e permissões explícitas de administração; associar os usuários aos grupos e só então ativá-los. A conta técnica usa sys\_id e não possui login interativo. Configurar app.user\_id com o UUID técnico durante o bootstrap, aplicar as colunas comuns e registrar a instalação antes de habilitar as triggers de auditoria. Após isso, todas as gravações usam o caminho autenticado e auditado.

\-- Executar no fim do bootstrap, após os CREATE TABLE das seções 2, 7, 8 e 9\.  
\-- O usuário técnico de instalação já deve existir e seu sys\_id estar no contexto.  
DO \$\$  
DECLARE  
    t TEXT;  
    actor UUID := NULLIF(current\_setting('app.user\_id', TRUE), '')::UUID;  
BEGIN  
    IF actor IS NULL OR NOT EXISTS (SELECT 1 FROM sys\_user WHERE sys\_id \= actor) THEN  
        RAISE EXCEPTION 'Bootstrap requer sys\_id de usuário técnico existente';  
    END IF;  
    FOREACH t IN ARRAY ARRAY\[  
        'sys\_db\_object','sys\_dictionary','sys\_choice','sys\_user','sys\_user\_group',  
        'sys\_user\_role','sys\_permission','sys\_user\_grmember','sys\_group\_has\_role',  
        'sys\_role\_has\_permission','sys\_number','sys\_number\_counter',  
        'sys\_state','sys\_script','sys\_state\_transition'  
    \] LOOP  
        EXECUTE format('ALTER TABLE %I  
            ADD COLUMN IF NOT EXISTS sys\_created\_on TIMESTAMPTZ DEFAULT clock\_timestamp(),  
            ADD COLUMN IF NOT EXISTS sys\_updated\_on TIMESTAMPTZ DEFAULT clock\_timestamp(),  
            ADD COLUMN IF NOT EXISTS sys\_created\_by UUID REFERENCES sys\_user(sys\_id) ON DELETE RESTRICT,  
            ADD COLUMN IF NOT EXISTS sys\_updated\_by UUID REFERENCES sys\_user(sys\_id) ON DELETE RESTRICT,  
            ADD COLUMN IF NOT EXISTS sys\_mod\_count INTEGER NOT NULL DEFAULT 0', t);  
        EXECUTE format('UPDATE %I SET  
            sys\_created\_by \= COALESCE(sys\_created\_by, \$1),  
            sys\_updated\_by \= COALESCE(sys\_updated\_by, \$1)', t) USING actor;  
        EXECUTE format('ALTER TABLE %I  
            ALTER COLUMN sys\_created\_by SET NOT NULL,  
            ALTER COLUMN sys\_updated\_by SET NOT NULL', t);  
        EXECUTE format(\$ddl\$ALTER TABLE %I  
            ALTER COLUMN sys\_created\_by SET DEFAULT NULLIF(current\_setting('app.user\_id', TRUE), '')::UUID,  
            ALTER COLUMN sys\_updated\_by SET DEFAULT NULLIF(current\_setting('app.user\_id', TRUE), '')::UUID\$ddl\$, t);  
    END LOOP;  
END;  
\$\$;

sys\_audit é append-only e usa seu próprio contrato changed\_by/changed\_on. No restante do Kernel, cada gravação preenche sys\_created\_by e sys\_updated\_by com sys\_user.sys\_id do contexto confiável, atualiza as datas e incrementa sys\_mod\_count. Atributos de autoria não são aceitos do cliente. Exclusão de usuários referenciados é bloqueada; utiliza-se desativação para preservar histórico.

## **3\. O Mecanismo dos "Campos do Kernel" (System Attributes)**

Toda tabela raiz de negócio recebe as colunas abaixo para identidade, polimorfismo, concorrência e auditoria. As tabelas do Kernel também usam sys\_id UUID, autoria por sys\_user.sys\_id, datas e versão, conforme a seção 2.3; sys\_class\_name é necessário às hierarquias TPT de negócio. number é um identificador legível opcional, configurado separadamente e obrigatório quando habilitado.

### **3.1 Colunas Obrigatórias da Tabela Raiz**

| Coluna | Tipo PostgreSQL | Finalidade |
| ----- | ----- | ----- |
| `sys_id` | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | Chave primária global e imutável do registro. |
| `sys_class_name` | `VARCHAR(80) NOT NULL` | **Discriminador Polimórfico:** indica a tabela concreta do registro (ex.: `'tbl_incident'`). |
| `sys_created_on` | `TIMESTAMPTZ DEFAULT clock_timestamp()` | Carimbo de data/hora de criação do registro. |
| `sys_created_by` | `UUID NOT NULL` | FK para sys\_user.sys\_id do autor, preenchida pelo backend. ON DELETE RESTRICT. |
| `sys_updated_on` | `TIMESTAMPTZ DEFAULT clock_timestamp()` | Carimbo de data/hora da última alteração. |
| `sys_updated_by` | `UUID NOT NULL` | FK para sys\_user.sys\_id de quem alterou, preenchida pelo backend. ON DELETE RESTRICT. |
| `sys_mod_count` | `INTEGER DEFAULT 0` | Contador de versão para controle de concorrência otimista (*Optimistic Locking*). |

### **3.2 Regra de Herança para Tabelas Filhas**

As tabelas derivadas **não replicam** nenhuma dessas colunas, exceto a chave primária `sys_id`:

* O campo `sys_id` da tabela filha atua simultaneamente como **Chave Primária (PK)** e **Chave Estrangeira (FK)** apontando para a tabela pai com `ON DELETE CASCADE`.  
* As colunas de auditoria (`sys_created_on`, `sys_updated_on`, etc.) e o discriminador (`sys_class_name`) residem **exclusivamente na tabela raiz**.

As referências a usuários, incluindo caller\_id, assigned\_to, manager\_id e campos de autoria, sempre armazenam UUID com FK para sys\_user(sys\_id). number, quando habilitado, é armazenado uma única vez na tabela que define o campo; descendentes TPT o herdam sem duplicá-lo. Seu valor não substitui sys\_id e não é usado como FK.

## **4\. Fluxo de Execução do DDL Engine (Backend Orchestrator)**

O backend expõe endpoints autenticados para criação de tabelas e campos. Antes do DDL, valida usuário ativo, grupos, roles e permissão execute sobre o catálogo de destino (por exemplo, sys\_db\_object/create\_table e sys\_dictionary/add\_field). O backend resolve metadados diretamente no banco e executa DDL e registros do dicionário na mesma transação. Todos os exemplos SQL pressupõem esse contexto confiável: app.user\_id recebe exclusivamente o sys\_id autenticado via set\_config(..., TRUE), limitado à transação.

\[Requisição na UI / API\]

           │

           ▼

\[DDL Orchestrator (Backend)\]

           │

           ├─► 0\. Validar autorização e definir app.user\_id (UUID) na transação

           ├─► 1\. Iniciar Transação (BEGIN)

           ├─► 2\. Inserir registro em sys\_db\_object

           ├─► 3\. SE super\_class\_id IS NULL:

           │        ├─► Inserir System Attributes em sys\_dictionary

           │        └─► Executar: CREATE TABLE tbl\_\<nome\> (com colunas de Kernel)

           ├─► 4\. SE super\_class\_id IS NOT NULL:

           │        ├─► Validar inexistência de ciclos de herança

           │        ├─► Executar: CREATE TABLE tbl\_\<nome\> (sys\_id UUID PK/FK)

           │        └─► Gerar View Polimórfica (v\_\<nome\>)

           ├─► 4.1 Se solicitado, cadastrar campo auto\_number e sua configuração  
           ├─► 4.2 Gerar restrições/FKs e auditoria; manter acesso negado sem permissões

           └─► 5\. Confirmar Transação (COMMIT)

### **4.1 Caso A: Criando a Tabela Base Dinamicamente (ex: `task`)**

BEGIN;

\-- 1\. Registro da tabela base no catálogo

INSERT INTO sys\_db\_object (name, label, super\_class\_id, is\_extendable)

VALUES ('tbl\_task', 'Tarefa', NULL, TRUE)

RETURNING sys\_id; \-- Retorna, por exemplo: '11111111-1111-1111-1111-111111111111'

\-- 2\. Cadastro dos atributos do kernel em sys\_dictionary

INSERT INTO sys\_dictionary (table\_id, column\_name, label, internal\_type, is\_system\_field)

VALUES 

  ('11111111-1111-1111-1111-111111111111', 'sys\_id', 'Sys ID', 'uuid', TRUE),

  ('11111111-1111-1111-1111-111111111111', 'sys\_class\_name', 'Classe', 'string', TRUE),

  ('11111111-1111-1111-1111-111111111111', 'sys\_created\_on', 'Criado em', 'timestamptz', TRUE),

  ('11111111-1111-1111-1111-111111111111', 'sys\_created\_by', 'Criado por', 'reference', TRUE),

  ('11111111-1111-1111-1111-111111111111', 'sys\_updated\_on', 'Atualizado em', 'timestamptz', TRUE),

  ('11111111-1111-1111-1111-111111111111', 'sys\_updated\_by', 'Atualizado por', 'reference', TRUE),

  ('11111111-1111-1111-1111-111111111111', 'sys\_mod\_count', 'Versão', 'integer', TRUE);

UPDATE sys\_dictionary  
SET reference\_table\_id \= (SELECT sys\_id FROM sys\_db\_object WHERE name \= 'sys\_user')  
WHERE table\_id \= '11111111-1111-1111-1111-111111111111'  
  AND column\_name IN ('sys\_created\_by', 'sys\_updated\_by');

\-- 3\. Criação física da tabela base no PostgreSQL

CREATE TABLE tbl\_task (

    sys\_id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),

    sys\_class\_name VARCHAR(80) NOT NULL,

    sys\_created\_on TIMESTAMPTZ DEFAULT clock\_timestamp(),

    sys\_created\_by UUID NOT NULL REFERENCES sys\_user(sys\_id) ON DELETE RESTRICT,

    sys\_updated\_on TIMESTAMPTZ DEFAULT clock\_timestamp(),

    sys\_updated\_by UUID NOT NULL REFERENCES sys\_user(sys\_id) ON DELETE RESTRICT,

    sys\_mod\_count INTEGER DEFAULT 0

);

\-- 4\. O usuário adiciona campos de negócio à task (ex: short\_description e state)

INSERT INTO sys\_dictionary (table\_id, column\_name, label, internal\_type, max\_length)

VALUES 

  ('11111111-1111-1111-1111-111111111111', 'short\_description', 'Descrição Curta', 'string', 160),

  ('11111111-1111-1111-1111-111111111111', 'state', 'Estado', 'string', 40);

ALTER TABLE tbl\_task 

  ADD COLUMN short\_description VARCHAR(160),

  ADD COLUMN state VARCHAR(40) DEFAULT 'draft';

\-- 5\. A interface solicitou numeração automática para task (TSK).  
ALTER TABLE tbl\_task ADD COLUMN number VARCHAR(22) NOT NULL UNIQUE;  
INSERT INTO sys\_dictionary (  
    table\_id, column\_name, label, internal\_type, max\_length, is\_mandatory, is\_read\_only  
) VALUES (  
    '11111111-1111-1111-1111-111111111111', 'number', 'Número', 'auto\_number', 22, TRUE, TRUE  
);  
WITH cfg AS (  
    INSERT INTO sys\_number (table\_id, field\_name, prefix, minimum\_digits, start\_number)  
    VALUES ('11111111-1111-1111-1111-111111111111', 'number', 'TSK', 7, 1\)  
    RETURNING sys\_id, start\_number  
)  
INSERT INTO sys\_number\_counter (number\_id, last\_value)  
SELECT sys\_id, start\_number \- 1 FROM cfg;

COMMIT;

### **4.2 Caso B: Criando a Tabela Filha Dinamicamente (ex: `incident` herdando de `task`)**

BEGIN;

\-- 1\. Registro da tabela filha referenciando a tabela pai

INSERT INTO sys\_db\_object (name, label, super\_class\_id, is\_extendable)

VALUES ('tbl\_incident', 'Incidente', '11111111-1111-1111-1111-111111111111', TRUE)

RETURNING sys\_id; \-- Retorna, por exemplo: '22222222-2222-2222-2222-222222222222'

\-- 2\. Cadastro dos campos específicos do incidente

INSERT INTO sys\_dictionary (table\_id, column\_name, label, internal\_type)  
VALUES  
  ('22222222-2222-2222-2222-222222222222', 'severity', 'Gravidade', 'integer'),  
  ('22222222-2222-2222-2222-222222222222', 'close\_notes', 'Notas de resolução', 'text');  
INSERT INTO sys\_dictionary (table\_id, column\_name, label, internal\_type, reference\_table\_id)  
SELECT '22222222-2222-2222-2222-222222222222', 'caller\_id', 'Solicitante', 'reference', sys\_id  
FROM sys\_db\_object WHERE name \= 'sys\_user';

\-- 3\. Criação física da tabela filha: PK é também FK apontando para a tabela pai

CREATE TABLE tbl\_incident (

    sys\_id UUID PRIMARY KEY,

    severity INTEGER,

    caller\_id UUID REFERENCES sys\_user(sys\_id) ON DELETE RESTRICT,

    close\_notes TEXT,

    CONSTRAINT fk\_incident\_parent\_task 

        FOREIGN KEY (sys\_id) REFERENCES tbl\_task(sys\_id) ON DELETE CASCADE

);

\-- 4\. Criação da View Polimórfica para leitura simplificada

CREATE OR REPLACE VIEW v\_incident AS

SELECT 

    p.sys\_id,

    p.sys\_class\_name,

    p.short\_description,

    p.number,

    p.state,

    p.sys\_created\_on,

    p.sys\_created\_by,

    p.sys\_updated\_on,

    p.sys\_updated\_by,

    p.sys\_mod\_count,

    c.severity,

    c.caller\_id,

    c.close\_notes

FROM tbl\_incident c

JOIN tbl\_task p ON c.sys\_id \= p.sys\_id;

COMMIT;

### **4.3 Numeração Automática em Qualquer Entidade**

Ao criar ou editar uma entidade pela interface, o usuário autorizado pode adicionar um campo do tipo auto\_number, escolher um prefixo de 1 a 3 caracteres, o número inicial e a quantidade mínima de dígitos. O nome padrão do campo é number. A engine cria o campo físico VARCHAR(22), o registro no dicionário, a configuração sys\_number e o contador; tasks não são pré-criadas.

Nos exemplos desta documentação, task recebe TSK com 7 dígitos e começa em TSK0000001. A configuração aparece no final do exemplo 4.1, antes da criação da view de incident, que já projeta p.number.

Para uma entidade que já possui registros, adicionar primeiro a coluna como nullable, bloquear gravações concorrentes durante a configuração, preencher os registros existentes pela mesma função geradora e só então aplicar NOT NULL e UNIQUE antes do commit. Toda configuração é feita sob autorização administrativa. Nenhum número é gerado apenas por abrir um formulário.

No TPT, a engine procura a configuração na tabela concreta e, na ausência dela, no ancestral mais próximo que define o campo. Uma configuração local inativa bloqueia a geração, sem fallback silencioso. Por padrão, incident herda o contador TSK de task e o valor fica em tbl\_task.number. Uma configuração específica para incident pode usar INC e contador próprio, mantendo o mesmo campo físico herdado; prefixos únicos evitam colisões entre configurações.

CREATE OR REPLACE FUNCTION sys\_next\_number(p\_number\_id UUID)  
RETURNS TEXT LANGUAGE plpgsql AS \$\$  
DECLARE  
    cfg sys\_number%ROWTYPE;  
    n BIGINT;  
    actor UUID := NULLIF(current\_setting('app.user\_id', TRUE), '')::UUID;  
BEGIN  
    IF actor IS NULL OR NOT EXISTS (  
        SELECT 1 FROM sys\_user WHERE sys\_id \= actor AND is\_active  
    ) THEN  
        RAISE EXCEPTION 'Usuário de execução ausente ou inativo';  
    END IF;  
    SELECT \* INTO cfg FROM sys\_number  
    WHERE sys\_id \= p\_number\_id FOR SHARE;  
    IF NOT FOUND OR NOT cfg.is\_active THEN  
        RAISE EXCEPTION 'Configuração de numeração ausente ou inativa';  
    END IF;  
    UPDATE sys\_number\_counter  
    SET last\_value \= last\_value \+ 1,  
        sys\_updated\_by \= actor,  
        sys\_updated\_on \= clock\_timestamp(),  
        sys\_mod\_count \= sys\_mod\_count \+ 1  
    WHERE number\_id \= cfg.sys\_id  
    RETURNING last\_value INTO n;  
    IF NOT FOUND THEN  
        RAISE EXCEPTION 'Contador não inicializado';  
    END IF;  
    RETURN cfg.prefix || lpad(n::TEXT,  
        greatest(cfg.minimum\_digits::INTEGER, length(n::TEXT)), '0');  
END;  
\$\$;  
REVOKE ALL ON FUNCTION sys\_next\_number(UUID) FROM PUBLIC;

A função é instalada após as colunas comuns da seção 2.3. Somente o papel técnico do backend recebe EXECUTE e acesso às tabelas necessárias, após a checagem de autorização da aplicação; usuários finais não acessam o banco diretamente. O backend resolve o UUID da configuração e chama sys\_next\_number na mesma transação do INSERT do registro.

O UPDATE bloqueia a linha do contador até o fim da transação, serializando emissões concorrentes daquela configuração. O incremento e o registro são confirmados juntos; rollback reverte ambos. Exclusões posteriores não reduzem o contador. Ao atingir o limite de BIGINT, a operação falha explicitamente. A largura é mínima: dígitos adicionais não são truncados. Não se usa cache nesta fase.

## **5\. Resolução Dinâmica de Atributos com Herança (CTE Recursivo)**

Como as tabelas derivadas não duplicam metadados em `sys_dictionary`, a aplicação resolve a árvore genealógica de campos em tempo de execução via Common Table Expressions (CTE).

\-- Dado o nome de qualquer tabela (ex: 'tbl\_incident'), recupera todos os campos disponíveis

WITH RECURSIVE table\_lineage AS (

    \-- Ponto de partida: a tabela consultada

    SELECT sys\_id, name, super\_class\_id, 0 AS inheritance\_level

    FROM sys\_db\_object

    WHERE name \= 'tbl\_incident'

    

    UNION ALL

    

    \-- Recursão: sobe para os pais na árvore genealógica

    SELECT parent.sys\_id, parent.name, parent.super\_class\_id, tl.inheritance\_level \+ 1

    FROM sys\_db\_object parent

    JOIN table\_lineage tl ON tl.super\_class\_id \= parent.sys\_id

)

SELECT 

    d.column\_name,

    d.label,

    d.internal\_type,

    d.is\_mandatory,

    d.is\_read\_only,

    d.default\_value,

    tl.name AS defined\_in\_table,

    tl.inheritance\_level

FROM table\_lineage tl

JOIN sys\_dictionary d ON d.table\_id \= tl.sys\_id

ORDER BY tl.inheritance\_level DESC, d.column\_name ASC;

A CTE acima resolve somente a estrutura. Antes de retornar metadados à UI, a engine aplica as permissões efetivas de tabela, registro e campo para produzir campos visíveis e editáveis. is\_read\_only impede escrita por regra estrutural; estar falso não concede permissão ao usuário. As condições são avaliadas no contexto do registro e de sys\_user.sys\_id. Herança de atributos não herda autorização e nenhum resultado é mantido em cache.

## **6\. Operações Polimórficas de Manipulação de Dados (CRUD Engine)**

A engine recebe a identidade autenticada como sys\_user.sys\_id, verifica usuário e grupos ativos e resolve permissões diretamente no PostgreSQL. Cada operação valida tabela concreta, registro, campos e ação antes de executar SQL. As consultas desta seção ilustram a persistência após autorização; não são endpoints públicos nem substituem os filtros de acesso. Escritas usam transação, contexto app.user\_id e auditoria.

### **6.1 Inserção Polimórfica (Create)**

Antes de criar incident, validar create na classe concreta e nos campos controlados, avaliar condition\_tree sobre o registro proposto e validar caller\_id como sys\_user.sys\_id existente. O backend gera um UUID v4 uma única vez, resolve a configuração de numeração e grava raiz e filha com o mesmo sys\_id. Campos de autoria e number são gerados no servidor e rejeitados se enviados como sobrescrita pelo cliente.

BEGIN;  
\-- O backend já validou a identidade e define app.user\_id nesta transação.  
\-- UUIDs do registro e do solicitante são ilustrativos; o solicitante deve existir.  
INSERT INTO tbl\_task (  
    sys\_id, sys\_class\_name, number, short\_description, state,  
    sys\_created\_by, sys\_updated\_by  
)  
SELECT  
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',  
    'tbl\_incident',  
    sys\_next\_number((  
        SELECT sys\_id FROM sys\_number  
        WHERE table\_id \= '11111111-1111-1111-1111-111111111111'  
          AND field\_name \= 'number'  
    )),  
    'VPN inacessível para filial remota', 'new',  
    current\_setting('app.user\_id')::UUID,  
    current\_setting('app.user\_id')::UUID;  
INSERT INTO tbl\_incident (sys\_id, severity, caller\_id)  
VALUES (  
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 1,  
    '00000000-0000-4000-8000-000000000003'  
);  
COMMIT;

A resposta contém sys\_id e number (por exemplo, TSK0000001). A referência a usuários sempre é o UUID, mesmo quando a UI exibe nome ou e-mail. Na API real, parâmetros são vinculados; os UUIDs constantes aqui representam valores de exemplo.

### **6.2 Leitura Polimórfica (Read)**

Consulta Polimórfica Genérica: a leitura da raiz considera as classes concretas em sys\_class\_name. O backend acrescenta filtros de autorização parametrizados antes de paginação e contagem, e retorna somente os campos permitidos.

SELECT sys\_id, number, sys\_class\_name, short\_description, state, sys\_created\_on  
FROM tbl\_task  
WHERE state \= 'new'; \-- Acrescentar predicados de autorização por classe/registro.

sys\_class\_name também indica à UI qual formulário/rota usar. Consulta Tipada Completa: usar a view como fonte com a mesma política, sem expor campos não autorizados.

SELECT sys\_id, number, short\_description, state  
FROM v\_incident  
WHERE severity \= 1; \-- Acrescentar predicados de autorização por registro.

Não basta filtrar a lista depois de paginar. A leitura por sys\_id aplica a mesma política; acessar tbl\_task ou v\_incident não permite contornar restrições da classe concreta. A engine projeta os campos permitidos e aplica as condições de leitura em SQL parametrizado ou mecanismo equivalente que preserve paginação e contagem corretas.

### **6.3 Atualização Otimista com Roteamento (Update)**

Ao receber um payload, a engine identifica sys\_user.sys\_id e valida update na tabela concreta, no registro atual e em cada campo solicitado. Também valida condições aplicáveis ao estado proposto. Em seguida:

1. Verifica se houve alteração no campo state. Se sim, valida também a ação de transição, required\_role\_id e condition\_tree. Uma rejeição provoca rollback; mesmo sem mudança de estado, a autorização de update continua obrigatória.  
2. Consulta o dicionário diretamente no banco, rejeita campos desconhecidos, sys\_id, number e autoria enviados pelo cliente, respeita is\_read\_only e distribui os campos autorizados entre pai e filha.  
3. Executa a instrução na tabela raiz com controle de concorrência otimista (`sys_mod_count`) e na tabela filha:

BEGIN;

\-- 1\. Atualização na tabela raiz com controle de concorrência

UPDATE tbl\_task

SET 

    short\_description \= 'VPN inacessível \- Atualizado escopo',

    state \= 'in\_progress',

    sys\_updated\_on \= clock\_timestamp(),

    sys\_updated\_by \= current\_setting('app.user\_id')::UUID,

    sys\_mod\_count \= sys\_mod\_count \+ 1

WHERE sys\_id \= 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

  AND sys\_mod\_count \= 0; \-- Se retornar 0 linhas afetadas, lança ConcurrencyConflictException

\-- 2\. Atualização dos campos especializados na tabela filha

UPDATE tbl\_incident

SET severity \= 2

WHERE sys\_id \= 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

COMMIT;

### **6.4 Exclusão Polimórfica em Cascata (Delete)**

Após validar delete na tabela concreta e no registro, excluir pela raiz em transação com app.user\_id definido. A autorização deve cobrir os registros de negócio afetados pela cascata; ON DELETE CASCADE não concede permissão:

DELETE FROM tbl\_task WHERE sys\_id \= 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

Graças à restrição `ON DELETE CASCADE` na foreign key da tabela filha, o PostgreSQL remove automaticamente a tupla correspondente em `tbl_incident`.

A exclusão não devolve o número ao contador. Para usuários e cadastros de segurança referenciados, preferir desativação e respeitar ON DELETE RESTRICT; a exclusão em cascata do TPT não se aplica automaticamente a esses cadastros.

## **7\. Trilha de Auditoria Universal (`sys_audit`)**

A auditoria registra INSERT, UPDATE e DELETE nas tabelas de negócio e nos cadastros/vínculos de segurança. Cada evento identifica o registro por UUID e o autor por sys\_user.sys\_id. O autor vem do contexto autenticado da transação, inclusive no DELETE; não é obtido do último sys\_updated\_by do registro nem de um nome textual como 'system'.

CREATE TABLE sys\_audit (  
    sys\_id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
    table\_name VARCHAR(80) NOT NULL,  
    document\_id UUID NOT NULL,  
    operation VARCHAR(6) NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),  
    field\_name VARCHAR(80) NOT NULL,  
    old\_value JSONB,  
    new\_value JSONB,  
    changed\_on TIMESTAMPTZ NOT NULL DEFAULT clock\_timestamp(),  
    changed\_by UUID NOT NULL REFERENCES sys\_user(sys\_id) ON DELETE RESTRICT  
);  
CREATE INDEX idx\_audit\_doc ON sys\_audit(table\_name, document\_id, changed\_on);  
CREATE OR REPLACE FUNCTION trg\_generic\_audit\_diff()  
RETURNS TRIGGER LANGUAGE plpgsql AS \$\$  
DECLARE  
    key\_name TEXT;  
    old\_map JSONB := '{}'::JSONB;  
    new\_map JSONB := '{}'::JSONB;  
    record\_id UUID;  
    actor UUID := NULLIF(current\_setting('app.user\_id', TRUE), '')::UUID;  
BEGIN  
    IF actor IS NULL OR NOT EXISTS (  
        SELECT 1 FROM sys\_user WHERE sys\_id \= actor AND is\_active  
    ) THEN  
        RAISE EXCEPTION 'Auditoria requer sys\_id de usuário ativo no contexto';  
    END IF;  
    IF TG\_OP \= 'INSERT' THEN  
        new\_map := to\_jsonb(NEW);  
        record\_id := NEW.sys\_id;  
    ELSIF TG\_OP \= 'DELETE' THEN  
        old\_map := to\_jsonb(OLD);  
        record\_id := OLD.sys\_id;  
    ELSE  
        old\_map := to\_jsonb(OLD);  
        new\_map := to\_jsonb(NEW);  
        record\_id := NEW.sys\_id;  
    END IF;  
    FOR key\_name IN SELECT jsonb\_object\_keys(old\_map || new\_map) LOOP  
        IF key\_name NOT IN ('sys\_updated\_on', 'sys\_mod\_count')  
           AND (TG\_OP \<\> 'UPDATE'  
                OR (old\_map \-\> key\_name) IS DISTINCT FROM (new\_map \-\> key\_name)) THEN  
            INSERT INTO sys\_audit (  
                table\_name, document\_id, operation, field\_name,  
                old\_value, new\_value, changed\_by  
            ) VALUES (  
                TG\_TABLE\_NAME, record\_id, TG\_OP, key\_name,  
                old\_map \-\> key\_name, new\_map \-\> key\_name, actor  
            );  
        END IF;  
    END LOOP;  
    IF TG\_OP \= 'DELETE' THEN RETURN OLD; END IF;  
    RETURN NEW;  
END;  
\$\$;  
CREATE TRIGGER trg\_audit\_tbl\_task  
AFTER INSERT OR UPDATE OR DELETE ON tbl\_task  
FOR EACH ROW EXECUTE FUNCTION trg\_generic\_audit\_diff();  
CREATE TRIGGER trg\_audit\_tbl\_incident  
AFTER INSERT OR UPDATE OR DELETE ON tbl\_incident  
FOR EACH ROW EXECUTE FUNCTION trg\_generic\_audit\_diff();

Na instalação, vincular a mesma trigger aos catálogos sys\_\* mutáveis, inclusive sys\_user, grupos, roles, permissões, associações e numeração, após concluir o bootstrap. Para tabelas de negócio, a DDL Engine vincula a trigger assim que cria cada tabela física; pai e filha são auditados dentro da mesma transação. Nunca instalar a trigger em sys\_audit, evitando recursão.

sys\_audit é append-only: leitura exige permissão própria, e UPDATE/DELETE são bloqueados para o papel de execução normal no banco. O caminho de gravação recebe apenas a capacidade de acrescentar eventos. document\_id permanece como UUID histórico e não tem FK para o registro auditado, pois o histórico deve sobreviver à exclusão.

O backend define app.user\_id com set\_config('app.user\_id', sys\_id\_autenticado, TRUE) após autenticar e validar o usuário; o valor não é aceito do payload. Conexões SQL não são expostas aos usuários. Contas de serviço também existem em sys\_user e possuem UUID, grupos e permissões explícitas. Os campos de autoria do registro são preenchidos pelo servidor; credenciais e segredos de autenticação não fazem parte dos valores auditados.

## **8\. Engine de Regras de Negócio (Business Rules)**

Para suportar automações e validações dinâmicas, o sistema implementa um catálogo declarativo com condições em Abstract Syntax Tree (JSON AST).

Criar, alterar ou executar regras exige permissões administrativas específicas. condition\_expression recebe contexto somente de leitura com current\_user\_id (UUID), grupos/roles efetivos, registro atual e registro proposto. A AST e as ações permitidas são validadas pelo servidor; nomes de tabela/campo são resolvidos pelo dicionário.

Por padrão, a regra executa com o sys\_id do solicitante. Execução como serviço deve ser declarada por administrador, referenciar uma conta técnica em sys\_user e usar somente suas permissões explícitas. A requisição original continua sujeita à autorização do solicitante; cada efeito colateral passa por autorização e auditoria. Alterações produzidas por regras são revalidadas antes da persistência, evitando contornar campos protegidos, numeração e transições.

CREATE TABLE sys\_script (

    sys\_id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),

    table\_id UUID NOT NULL REFERENCES sys\_db\_object(sys\_id) ON DELETE CASCADE,

    name VARCHAR(100) NOT NULL,

    timing VARCHAR(20) NOT NULL,             \-- 'before\_insert', 'before\_update', 'after\_insert', 'after\_update'

    execution\_order INTEGER DEFAULT 100,

    execution\_mode VARCHAR(10) NOT NULL DEFAULT 'caller'  
        CHECK (execution\_mode IN ('caller', 'service')),  
    run\_as\_user\_id UUID REFERENCES sys\_user(sys\_id) ON DELETE RESTRICT,

    condition\_expression JSONB NOT NULL,     \-- Árvore lógica declarativa

    action\_type VARCHAR(40) NOT NULL,        \-- 'set\_field\_value', 'abort\_transaction', 'execute\_script'

    action\_payload JSONB NOT NULL,           \-- Configuração da ação a executar

    is\_active BOOLEAN DEFAULT TRUE,

    sys\_created\_on TIMESTAMPTZ DEFAULT clock\_timestamp(),

    CONSTRAINT ck\_script\_actor CHECK (  
        (execution\_mode \= 'caller' AND run\_as\_user\_id IS NULL)  
        OR (execution\_mode \= 'service' AND run\_as\_user\_id IS NOT NULL)  
    )

);

## **9\. Máquina de Estados e Ciclo de Vida Polimórfico (State Transitions)**

Para impedir movimentações arbitrárias de status (ex.: mover um chamado direto de *Novo* para *Fechado* sem passar por *Resolvido* ou sem autorização), a engine incorpora uma Máquina de Estados Finita (FSM) declarativa e orientada a metadados.

A FSM é **estritamente atrelada à tabela `sys_state`**. Esta tabela armazena os rótulos de cada status (`label`), seus nomes técnicos (`name`), ordenação e cores. A máquina de estados controla especificamente **qualquer coluna no catálogo que seja uma referência (`internal_type = 'reference'`) para `sys_state`** — incluindo compulsoriamente a coluna `state` da tabela raiz `tbl_task`.

### **9.1 Catálogo Central de Estados (`sys_state`)**

CREATE TABLE sys\_state (
    sys\_id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),
    table\_id UUID REFERENCES sys\_db\_object(sys\_id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    label VARCHAR(80) NOT NULL,
    sequence INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    color VARCHAR(30) DEFAULT 'slate',
    description TEXT,
    sys_created_on TIMESTAMPTZ DEFAULT clock_timestamp(),
    sys_updated_on TIMESTAMPTZ DEFAULT clock_timestamp(),
    sys_created_by UUID REFERENCES sys_user(sys_id) ON DELETE RESTRICT,
    sys_updated_by UUID REFERENCES sys_user(sys_id) ON DELETE RESTRICT,
    sys_mod_count INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq_state_name_table UNIQUE (table_id, name)
);

CREATE INDEX idx_state_lookup ON sys_state(name, table_id) WHERE is_active = TRUE;

Os estados padrão do sistema (`draft`, `new`, `in_progress`, `resolved`, `closed`, `canceled`) são provisionados no bootstrap com UUIDs determinísticos de `30000000-0000-0000-0000-000000000001` a `...0006`.

### **9.2 Catálogo de Transições (`sys_state_transition`)**

CREATE TABLE sys\_state\_transition (
    sys\_id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),
    table\_id UUID NOT NULL REFERENCES sys\_db\_object(sys\_id) ON DELETE CASCADE,
    state\_field VARCHAR(80) DEFAULT 'state',       \-- Campo que referencia sys_state
    from\_state\_id UUID NOT NULL REFERENCES sys\_state(sys\_id) ON DELETE CASCADE,
    to\_state\_id UUID NOT NULL REFERENCES sys\_state(sys\_id) ON DELETE CASCADE,
    from\_state VARCHAR(50),                       \-- Nome de origem sincronizado
    to\_state VARCHAR(50),                         \-- Nome de destino sincronizado
    label VARCHAR(80),                             \-- Rótulo do botão/ação na UI (ex: 'Iniciar Atendimento')
    required\_role\_id UUID REFERENCES sys\_user\_role(sys\_id) ON DELETE RESTRICT,
    condition\_tree JSONB,                          \-- Regras adicionais necessárias para liberar a transição
    on\_transition\_action JSONB,                    \-- Mutações atômicas de efeito colateral
    is\_active BOOLEAN DEFAULT TRUE,
    sys\_created\_on TIMESTAMPTZ DEFAULT clock\_timestamp(),
    sys\_updated\_on TIMESTAMPTZ DEFAULT clock\_timestamp(),
    sys\_created\_by UUID REFERENCES sys\_user(sys\_id) ON DELETE RESTRICT,
    sys\_updated\_by UUID REFERENCES sys\_user(sys\_id) ON DELETE RESTRICT,
    sys\_mod\_count INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq\_state\_transition\_ids UNIQUE (table\_id, state\_field, from\_state\_id, to\_state\_id)
);

CREATE INDEX idx\_transition\_ids\_lookup 
ON sys\_state\_transition(table\_id, state\_field, from\_state\_id, to\_state\_id) 
WHERE is\_active \= TRUE;

required\_role\_id usa a chave UUID da role, com FK que impede referências inexistentes. Cada transição tem action\_name determinístico: `transition:<from_state_name>:<to_state_name>`, associado ao table\_id concreto em sys\_permission.

### **9.3 Modelagem da Coluna `state` em `tbl_task`**

A coluna `state` em `tbl_task` é tipada fisicamente como `UUID REFERENCES sys_state(sys_id)` com valor padrão apontando para o status `new` (`30000000-0000-0000-0000-000000000002`). No `sys_dictionary`, seu tipo é registrado formalmente como `internal_type = 'reference'` com `reference_table_id = sys_state.sys_id`. A FSM detecta dinamicamente através do dicionário qualquer atributo que referencie `sys_state` e valida todas as mudanças de valor contra as transições cadastradas.

### **9.4 Resolução Polimórfica de Transições com Herança e Labels**

Como estamos utilizando **Table-per-Type (TPT)**, uma tabela filha (ex.: `tbl_incident`) herda o campo `state` definido na tabela pai (`tbl_task`). A engine aplica precedência através da CTE recursiva, enriquecendo as transições com os rótulos de `sys_state`:

WITH RECURSIVE table\_lineage AS (
    SELECT sys\_id, name, super\_class\_id, 0 AS depth
    FROM sys\_db\_object
    WHERE name \= 'tbl\_incident'

    UNION ALL

    SELECT parent.sys\_id, parent.name, parent.super\_class\_id, tl.depth \+ 1
    FROM sys\_db\_object parent
    JOIN table\_lineage tl ON tl.super\_class\_id \= parent.sys\_id
)
SELECT DISTINCT ON (st.from\_state\_id, st.to\_state\_id)
    st.sys\_id,
    st.from\_state\_id,
    COALESCE(fs.name, st.from\_state, '') AS from\_state,
    COALESCE(fs.label, st.from\_state, '') AS from\_state\_label,
    st.to\_state\_id,
    COALESCE(ts.name, st.to\_state, '') AS to\_state,
    COALESCE(ts.label, st.to\_state, '') AS to\_state\_label,
    st.label,
    st.required\_role\_id,
    st.condition\_tree,
    tl.name AS defined\_in\_table,
    tl.depth
FROM table\_lineage tl
JOIN sys\_state\_transition st ON st.table\_id \= tl.sys\_id
LEFT JOIN sys\_state fs ON fs.sys\_id \= st.from\_state\_id
LEFT JOIN sys\_state ts ON ts.sys\_id \= st.to\_state\_id
WHERE st.state\_field \= 'state' AND st.is\_active \= TRUE
ORDER BY st.from\_state\_id, st.to\_state\_id, tl.depth ASC;

A herança seleciona a definição de transição, mas não concede acesso. Mesmo quando a definição vem de task, a autorização é avaliada para a classe concreta do registro (por exemplo, tbl\_incident), usando suas permissões explícitas e as roles herdadas dos grupos do usuário.

### **9.3 Pipeline de Validação no Backend Orchestrator**

O backend verifica o usuário por sys\_user.sys\_id e resolve grupos, roles e permissões diretamente no banco em cada operação. Nenhuma checagem depende de cache ou de claims de roles enviados pelo cliente.

\[Requisição autenticada: usuário UUID \+ registro UUID \+ payload\]  
    ↓  
\[Usuário ativo, grupo ativo e permissão update na classe/registro/campos?\]  
    ├─ NÃO → Negar operação  
    └─ SIM  
        ↓  
\[Campo de estado mudou?\]  
    ├─ NÃO → Update regular autorizado  
    └─ SIM  
        ↓  
\[Existe transição válida do estado atual para o destino?\]  
    ├─ NÃO → Negar transição  
    └─ SIM  
        ↓  
\[Permissão execute para transition:\<origem\>:\<destino\> na classe concreta?\]  
    ├─ NÃO → Negar ação  
    └─ SIM  
        ↓  
\[required\_role\_id é NULL ou está nas roles ativas herdadas dos grupos?\]  
    ├─ NÃO → Negar por role insuficiente  
    └─ SIM  
        ↓  
\[condition\_tree atende ao registro proposto e ao contexto?\]  
    ├─ NÃO → Negar por condição não atendida  
    └─ SIM → Aplicar efeitos autorizados e UPDATE atômico com versão \+ auditoria

A gravação revalida o estado e a versão usados na decisão. Concorrência que altere o registro provoca rejeição ou nova avaliação; sys\_mod\_count e o controle transacional impedem persistir uma transição baseada em estado desatualizado. Erros em regras, autorização, auditoria ou persistência causam rollback.

### **9.4 Exemplo de Definição Declarativa (Condições de Transição)**

Para configurar a transição de um Incidente de `in_progress` para `resolved`, exigindo que as notas de resolução estejam preenchidas e o usuário seja da equipe técnica:

A preparação abaixo é executada por administrador autorizado, na mesma transação e com app.user\_id definido. A role deve existir e estar ativa antes de cadastrar a transição; toda configuração valida essa condição. Em seguida, o UUID dessa role é gravado em required\_role\_id.

\-- Preparação do exemplo: solicitante UUID deve existir e estar ativo.  
INSERT INTO sys\_user\_role (name, description)  
VALUES ('itil\_resolver', 'Resolver incidentes') ON CONFLICT (name) DO NOTHING;  
INSERT INTO sys\_user\_group (name, description)  
VALUES ('Gestão de Incidentes', 'Equipe de resolução') ON CONFLICT (name) DO NOTHING;  
INSERT INTO sys\_permission (name, table\_id, operation, action\_name)  
VALUES  
 ('incident.update', '22222222-2222-2222-2222-222222222222', 'update', NULL),  
 ('incident.resolve', '22222222-2222-2222-2222-222222222222', 'execute',  
  'transition:in\_progress:resolved')  
ON CONFLICT (name) DO NOTHING;  
INSERT INTO sys\_group\_has\_role (group\_id, role\_id)  
SELECT g.sys\_id, r.sys\_id FROM sys\_user\_group g CROSS JOIN sys\_user\_role r  
WHERE g.name \= 'Gestão de Incidentes' AND r.name \= 'itil\_resolver'  
ON CONFLICT (group\_id, role\_id) DO NOTHING;  
INSERT INTO sys\_role\_has\_permission (role\_id, permission\_id)  
SELECT r.sys\_id, p.sys\_id FROM sys\_user\_role r CROSS JOIN sys\_permission p  
WHERE r.name \= 'itil\_resolver' AND p.name IN ('incident.update','incident.resolve')  
ON CONFLICT (role\_id, permission\_id) DO NOTHING;  
INSERT INTO sys\_user\_grmember (user\_id, group\_id)  
SELECT '00000000-0000-4000-8000-000000000003'::UUID, sys\_id  
FROM sys\_user\_group WHERE name \= 'Gestão de Incidentes'  
ON CONFLICT (user\_id, group\_id) DO NOTHING;

INSERT INTO sys\_state\_transition (

    table\_id,

    state\_field,

    from\_state,

    to\_state,

    label,

    required\_role\_id,

    condition\_tree

)

VALUES (

    '22222222-2222-2222-2222-222222222222', \-- sys\_id de tbl\_incident

    'state',

    'in\_progress',

    'resolved',

    'Resolver Incidente',

    (SELECT sys\_id FROM sys\_user\_role WHERE name \= 'itil\_resolver'),

    '{

        "operator": "AND",

        "rules": \[

            {

                "field": "close\_notes",

                "operator": "IS\_NOT\_EMPTY"

            },

            {

                "field": "severity",

                "operator": "LESS\_THAN\_OR\_EQUAL",

                "value": 3

            }

        \]

    }'::jsonb

);

### **9.5 Geração Automática de Botões na Interface (UI Actions)**

A API expõe o endpoint `GET /api/v1/records/:table/:sys_id/available-transitions`.

Ao abrir o formulário, available-transitions avalia o usuário por sys\_id, as permissões update/execute na classe concreta, required\_role\_id e as condições do registro atual, consultando o banco diretamente. Os botões representam disponibilidade naquele momento; executar a ação exige nova validação no backend com o payload proposto. Ocultar botões não substitui autorização:

* `[ Atribuir a Mim ]` (se estiver em *Novo*)  
* `[ Resolver Incidente ]` (se estiver em *Em Andamento*)  
* `[ Cancelar Chamado ] (se houver permissão execute, role adicional quando exigida e condições atendidas)`

## **10\. Considerações de Engenharia e Performance em Produção**

1. **Namespaces e Prefixagem Segura:**  
   * Todas as tabelas criadas pelo usuário devem receber um prefixo automático “`tbl_`” para evitar colisões com palavras reservadas da ANSI SQL (`order`, `user`, `group`, `case`, etc.).

### **10.1 Consultas Diretas, Índices e Concorrência**

* Sem cache nesta fase: metadados, estado ativo, associações, roles, permissões, regras, transições e numeração são consultados no PostgreSQL em cada operação. Não há cache local/distribuído nem pré-alocação de números. Uma estratégia de cache será avaliada em fase futura.  
* Sessões: armazenam a identidade por sys\_user.sys\_id e não congelam roles/permissões. Uma revogação ou desativação confirmada deve ser observada na próxima avaliação de autorização; para escritas, essa avaliação ocorre dentro da transação. O estado usado em operações já em andamento segue o isolamento e os bloqueios transacionais definidos.  
* Índices: manter as chaves UNIQUE dos vínculos, os índices reversos da seção 2.1, índices por tabela/operação em sys\_permission e por tabela/campo em sys\_number. Cada campo number habilitado possui UNIQUE na tabela física que o armazena. UUIDs são IDs; BIGINT é usado somente para valores de sequência, nunca como chave concorrente ao padrão UUID.  
* Numeração concorrente: UPDATE ... RETURNING serializa o contador por configuração; entidades com configurações distintas não disputam a mesma linha. Contador e INSERT pertencem à mesma transação. Proteger alteração de configuração com bloqueio e proibir redução do contador/reutilização de prefixos.  
* Integridade de associações: criação/ativação do usuário, remoção do último vínculo e desativação/exclusão de grupos devem manter pelo menos um grupo ativo por usuário ativo. Executar essas mudanças em transações SERIALIZABLE, validar todos os usuários afetados antes do commit e repetir a transação inteira em falha de serialização. Não basta checar cada linha isoladamente.  
* Operações comuns usam isolamento READ COMMITTED com autorização no banco e controle de versão. Alterações de configuração e backfill de numeração bloqueiam as estruturas afetadas até concluir. Identificadores SQL são validados no dicionário e escapados; valores usam parâmetros.

## **11\. Usuários, Grupos, Roles e Permissões (Controle de Acesso)**

O controle de acesso segue o modelo de usuários, grupos e roles do ServiceNow, com a cadeia de concessão definida para esta plataforma: Usuário → Grupos → Roles → Permissões. Esta seção complementa o Kernel com identidade e autorização, mantendo as tabelas de negócio sob a engine dinâmica já descrita.

### **11.1 Entidades e Cadastro do Usuário**

* Usuário (sys\_user): representa a identidade que acessa a plataforma. Possui sys\_id (UUID), user\_name único e obrigatório, nome, sobrenome, e-mail e is\_active. O cadastro também contempla telefone, cargo, departamento, empresa, gestor (referência a sys\_user), idioma e fuso horário, conforme aplicável.  
* Grupo (sys\_user\_group): reúne usuários por equipe ou responsabilidade. Possui sys\_id, nome único, descrição, is\_active e gestor (referência a sys\_user). Um grupo pode conter vários usuários e receber várias roles.  
* Role (sys\_user\_role): representa um papel funcional, como service\_desk ou itil\_resolver. Possui sys\_id, nome técnico único, descrição e is\_active. Uma mesma role pode ser atribuída a vários grupos e reunir várias permissões.  
* Permissão (sys\_permission): define uma operação autorizada sobre um recurso. Possui sys\_id, nome técnico único, descrição, is\_active, table\_id (referência a sys\_db\_object), operação (create, read, update, delete ou execute), campo opcional e condition\_tree opcional para restrições por registro. Para execute, identifica também a ação autorizada.

As entidades e seus vínculos integram o Kernel (sys\_\*) e são cadastrados no dicionário conforme a seção 2\. Toda PK e FK usa UUID v4; user\_id, manager\_id, caller\_id, assigned\_to, run\_as\_user\_id e campos de autoria referenciam sys\_user.sys\_id. E-mail e user\_name nunca identificam usuários nos relacionamentos. A identidade autenticada da sessão é um sys\_id; credenciais são tratadas separadamente.

### **11.2 Relacionamentos e Integridade**

* Usuário ↔ Grupo: relação muitos-para-muitos em sys\_user\_grmember, com user\_id e group\_id. Cada usuário habilitado para operar deve pertencer a um ou mais grupos; cada grupo pode reunir diversos usuários.  
* Grupo ↔ Role: relação muitos-para-muitos em sys\_group\_has\_role, com group\_id e role\_id. As roles são atribuídas aos grupos e herdadas por seus membros.  
* Role ↔ Permissão: relação muitos-para-muitos em sys\_role\_has\_permission, com role\_id e permission\_id. As permissões são atribuídas às roles.

Cada tabela de vínculo possui sys\_id UUID, FKs UUID e UNIQUE para o par. Usuários podem ser cadastrados inativos; a criação como ativo ou a ativação exige ao menos um grupo ativo. Remover o último grupo, desativá-lo ou excluí-lo exige vincular os usuários ativos afetados a outro grupo ativo ou desativá-los na mesma transação. A validação concorrente segue a seção 10.1.

A hierarquia acima representa o caminho de concessão de acesso, não a herança TPT entre tabelas. Neste modelo, roles não são atribuídas diretamente a usuários, e permissões não são atribuídas diretamente a usuários ou grupos.

### **11.3 Herança e Cálculo do Acesso Efetivo**

As roles efetivas de um usuário correspondem à união, sem duplicatas, das roles ativas atribuídas a todos os seus grupos ativos. Suas permissões candidatas correspondem à união das permissões ativas vinculadas a essas roles. Uma permissão com condição somente autoriza o acesso quando a condição também é satisfeita no contexto da operação.

* Adicionar um usuário a um grupo disponibiliza as roles e permissões daquele grupo; remover o vínculo retira apenas os acessos concedidos por esse caminho.  
* Se outro grupo continuar concedendo a mesma role ou permissão, o usuário mantém esse acesso. Duplicidade de caminhos não multiplica privilégios.  
* Alterações nas roles de um grupo ou nas permissões de uma role repercutem nos usuários associados após o commit. O backend consulta o banco em cada operação; não há cache nem mecanismo de invalidação nesta fase.  
* Usuários inativos não podem acessar a plataforma. Grupos, roles e permissões inativos não participam do cálculo. Sem permissão aplicável, a operação é negada.

### **11.4 Validação no Backend e Integração com a Engine**

Toda requisição deve identificar o usuário autenticado, validar seu estado ativo, resolver suas roles e permissões efetivas e verificar recurso, operação e condições antes de retornar dados ou persistir alterações. A interface pode ocultar ações indisponíveis, mas a autorização é obrigatoriamente reavaliada no backend.

Permissões de tabela controlam CRUD; permissões execute controlam ações nomeadas. table\_id identifica a classe concreta e condition\_tree restringe o registro. Concessões aplicáveis no mesmo nível combinam-se por OR; tabela/registro e controles de campo combinam-se por AND. Se existirem regras ativas para um campo/operação, o usuário deve satisfazer ao menos uma delas; sem regra específica de campo, vale a autorização de tabela/registro. Nenhuma regra dispensa is\_read\_only ou campos gerados pelo servidor.

Nas tabelas TPT, a checagem considera a tabela concreta e o recurso acessado. Herança estrutural de campos não concede acesso automaticamente à tabela filha; o escopo de uma permissão deve ser explícito.

O campo required\_role\_id de sys\_state\_transition é uma FK UUID para sys\_user\_role.sys\_id e é comparado às roles ativas herdadas dos grupos. A transição exige permissão update, permissão execute para a ação, a role adicional quando preenchida e condition\_tree satisfeita. required\_role\_id NULL dispensa somente a checagem adicional de role.

O endpoint de available-transitions usa a mesma avaliação para exibir os botões permitidos. Ao executar a transição, o backend refaz a checagem sobre o estado atual do registro, antes da gravação atômica.

### **11.5 Administração e Auditoria**

A administração segue a organização do ServiceNow: cadastro de usuários com seus grupos e acessos herdados; cadastro de grupos com membros e roles; cadastro de roles com suas permissões; e cadastro das regras de acesso. As telas devem permitir identificar o grupo e a role que originaram cada permissão efetiva.

Somente usuários com permissões explícitas podem administrar esses cadastros e vínculos. A auditoria da seção 7 registra INSERT, UPDATE e DELETE com autor por sys\_user.sys\_id, momento, operação e valores. Desativar preserva referências e histórico. Contas de serviço usam o mesmo modelo de UUID, grupos, roles e permissões; ser gestor de um grupo não concede automaticamente privilégios administrativos.

### **11.6 Exemplo de Funcionamento**

O usuário de sys\_id 00000000-0000-4000-8000-000000000003 pertence aos grupos Service Desk e Gestão de Incidentes. Service Desk recebe a role service\_desk para leitura/atualização; Gestão de Incidentes recebe itil\_resolver com permissões update e execute para resolver incidentes. Os vínculos entre todas essas entidades usam seus UUIDs, conforme o exemplo da seção 9.4.

O usuário reúne os acessos dos dois grupos. Para executar a transição para resolved, deve possuir a role itil\_resolver e atender às permissões e condições configuradas, incluindo as notas de resolução do exemplo da seção 9\. Se for removido do grupo Gestão de Incidentes, perde os acessos provenientes dele, salvo quando outro grupo ainda os conceder.

Referência conceitual: [ServiceNow — Assign a group role](https://www.servicenow.com/docs/r/platform-administration/user-administration/t_AssignRoleToGroup.html).

---

## **12. Arquitetura de Interface: Visualização em Páginas Próprias de Detalhes (Form View) e CRUD Universal**

### **12.1 Princípio da Página Dedicada por Entidade (Eliminação de Diálogos e Modais)**
Para proporcionar uma experiência profissional e alinhada às plataformas de grande porte (ServiceNow, Salesforce Lightning), **todas as entidades da plataforma possuem sua própria página completa de visualização/edição, extinguindo caixas de diálogo e modais sobrepostos**:
1. **Navegação Limpa:** Clicar em qualquer registro ou configuração na listagem substitui a tabela pela visualização detalhada da entidade correspondente, fornecendo barra de navegação/breadcrumbs para retorno à lista.
2. **Edição In-Place na Mesma Tela:** A tela de detalhes abre por padrão no modo de visualização. O usuário dispõe de um botão de ação **"Editar"** que transforma o formulário em modo interativo de edição no **mesmo layout e mantendo rigorosamente a mesma disposição visual dos campos**, evitando trocas abruptas de tela ou caixas flutuantes.
3. **Botão de Exclusão Direta:** Cada página de detalhes dispõe do botão **"Excluir"**, permitindo expurgar a entidade diretamente de sua tela com validação atômica no banco de dados e retorno à listagem.

### **12.2 Cobertura Completa de CRUD em Todas as Entidades**
* **Record Studio:** Navegação e formulários dinâmicos para qualquer tabela física ou visão TPT polimórfica, suporte a concorrência otimista (`sys_mod_count`), botões dinâmicos de transição de estado FSM e gaveta lateral de trilha de auditoria universal (`sys_audit`).
* **Schema Studio:**
  * **Tabelas (`sys_db_object`):** Página de detalhes com formulário para atualizar propriedades (rótulo, permissão de herança) e exclusão com cascateamento físico (`DROP TABLE ... CASCADE`).
  * **Campos (`sys_dictionary`):** Página própria de formulário para criação, edição in-place (rótulo, obrigatoriedade, somente-leitura, valor padrão) e exclusão física da coluna (`ALTER TABLE ... DROP COLUMN ... CASCADE`) com regeneração imediata de views polimórficas.
  * **Opções Choice (`sys_choice`):** Página própria de formulário para criação, edição in-place de valores e exclusão física.
* **Máquina de Estados FSM (`sys_state_transition`):** Página de detalhes da transição com edição in-place dos estados de origem/destino, rótulo, papel exigido, editor de árvore de condições JSON AST e ação mutadora `on_transition_action`, com exclusão física no catálogo.
* **Regras de Negócio (`sys_script`):** Página de detalhes da regra com edição in-place de todos os parâmetros (nome, tabela, timing, ordem, modo de execução, usuário executor, tipo de ação, condição AST e script/payload da ação). Durante a edição, disponibiliza botão split com dropdown contextual contendo as opções **"Salvar como nova regra"** (clonagem com validações completas de novo registro) e **"Deletar"** (exclusão física do catálogo com confirmação modal).
* **Identidade e Segurança RBAC:** Módulo dedicado que unifica em telas com o mesmo padrão visual de formulário:
  * **Usuários (`sys_user`):** CRUD com gestão segura de senha (criptografada com bcrypt em `sys_user_credential`) e associação direta a grupos.
  * **Grupos (`sys_user_group`):** CRUD com associação direta a papéis (roles) e visualização de membros.
  * **Papéis / Roles (`sys_user_role`):** CRUD com associação direta a permissões de recursos.
  * **Permissões (`sys_permission`):** CRUD com definição de tabelas, operações (`create`, `read`, `update`, `delete`, `execute`), campos e árvores de condições.


