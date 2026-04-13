CREATE TABLE tecnicos (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    ativo BOOLEAN DEFAULT TRUE
);

-- Tabela de setores
CREATE TABLE setores (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    descricao TEXT
);

-- Tabela de chamados
CREATE TABLE chamados (
    id SERIAL PRIMARY KEY,
    titulo VARCHAR(200) NOT NULL,
    usuario_nome VARCHAR(200),
    descricao TEXT NOT NULL,
    tecnico_id INTEGER REFERENCES tecnicos(id),
    setor_id INTEGER REFERENCES setores(id),
    status VARCHAR(20) DEFAULT 'em_andamento',
    problema TEXT,
    solucao TEXT,
    tecnico_anterior_id INTEGER REFERENCES tecnicos(id),
    data_abertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_fechamento TIMESTAMP
);

-- Inserir dados de exemplo
INSERT INTO tecnicos (nome, email) VALUES 
('João Silva', 'joao@empresa.com'),
('Maria Santos', 'maria@empresa.com'),
('Pedro Alves', 'pedro@empresa.com');

INSERT INTO setores (nome, descricao) VALUES 
('TI', 'Setor de Tecnologia da Informação'),
('Financeiro', 'Setor Financeiro'),
('RH', 'Recursos Humanos'),
('Produção', 'Setor de Produção');


Alter table chamados
add column aguardando_solucao boolean default false,
add column usuario_nome  varchar(100);

ALTER TABLE chamados
add column aguardando_solucao boolean default false;

Alter table setores
add column ativo boolean default true;

ALTER TABLE nivel_tecnico RENAME TO niveis_tecnico;

Create table nivel_tecnico(
id serial primary key,
nome varchar(10),
descricao  text,
codigo_acesso boolean default true
);


Alter table tecnicos
add column nivel_id int references nivel_tecnico(id),
add column telegram_chat_id varchar(50),
add column whatsapp varchar(30),
add column usuario_login varchar(50),
add column senha_hash varchar(255),
add column senha_alterada boolean default true;


Update tecnicos 
Set nome = 'Renato Pedrozo', telegram_chat_id = 7330023040
Where id = 4;

Update tecnicos
Set nome = 'Ingrid Gabrielly', telegram_chat_id = 5750497450
where id = 5;

Update tecnicos
Set nome = 'Ana Paula', telegram_chat_id = 1269968767
where id = 6;

ALTER TABLE nivel_tecnico
ALTER COLUMN codigo_acesso TYPE VARCHAR(20);

insert into nivel_tecnico (nome, descricao, codigo_acesso) values
('N1', 'Suporte Inicial - problemas básicos', 'N1'),
('N2', 'Suporte Intermediário - problemas complexos', 'N2'),
('N2', 'Suporte Avançado - problemas críticos', 'N3');

update niveis_tecnico
set nome = 'N3'
where id = 3;

delete from niveis_tecnico
where id = 4 ;

delete from niveis_tecnico
where id = 5 ;

delete from niveis_tecnico
where id = 6 ;

alter table tecnicos
drop column email;

alter table chamados
alter column aguardando_solucao TYPE VARCHAR(100);


update tecnicos
Set nivel_id = 1, whatsapp = '92985960189', usuario_login = 'Ingrid'
where id = 5;

update tecnicos
Set nivel_id = 1, whatsapp = '9294900663', usuario_login = 'Ana'
where id = 6;

update tecnicos
Set nivel_id = 2, whatsapp = '92991524473', usuario_login = 'Renato'
where id = 4;

select * from tecnicos;

