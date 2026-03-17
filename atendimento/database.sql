-- Criar o banco de dados
CREATE DATABASE gerenciador_chamados;

-- Conectar ao banco de dados
\c gerenciador_chamados;

-- Tabela de técnicos
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
