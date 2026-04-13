const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const bodyParser = require('body-parser');
const axios = require('axios');
const session = require('express-session');
const bcrypt = require('bcrypt');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();
const port = process.env.PORT || 2999;
const host = process.env.HOST || '10.46.5.244';

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Configuração de sessão PRIMEIRO
app.use(session({
  secret: process.env.SESSION_SECRET || 'sepror-chamados-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 8 * 60 * 60 * 1000 } // 8 horas
}));

// ==============================================
// MIDDLEWARE DE AUTENTICAÇÃO
// ==============================================

// Credenciais simples
const CREDENCIAIS = {
  usuario: process.env.ADMIN_USER || 'admin',
  senha: process.env.ADMIN_PASSWORD || 'admin123'
};

// Middleware para verificar autenticação
function verificarAutenticacao(req, res, next) {
  // Não requer autenticação para rotas públicas
  const rotasPublicas = [
    '/api/login',
    '/api/logout',
    '/api/auth/status',
    '/api/tecnicos',
    '/api/setores', 
    '/api/chamados',
    '/login.html',
    '/index.html',
    '/',
    '/style.css',
    '/favicon.ico'
  ];
  
  // Verificar se a rota atual é pública
  const isRotaPublica = rotasPublicas.some(rota => {
    return req.path === rota || req.path.startsWith(rota + '/');
  });
  
  if (isRotaPublica) {
    return next();
  }
  
  // Proteger rotas de gerenciamento
  const rotasProtegidas = [
    'manager',
    'tecnicos', 
    'setores',
    '/api/tecnicos/todos',
    '/api/setores/todos'
  ];
  
  const isRotaProtegida = rotasProtegidas.some(rota => {
    return req.path.includes(rota);
  });
  
  if (isRotaProtegida) {
    if (req.session && req.session.autenticado) {
      return next();
    }
    
    // Se for API, retornar erro JSON, senão redirecionar para login
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Não autorizado' });
    }
    
    return res.redirect('/login.html');
  }
  
  // Para todas as outras rotas não especificadas, permitir acesso
  next();
}

// Aplicar middleware de autenticação
app.use(verificarAutenticacao);

// Configuração do banco de dados
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'gerenciador_chamados',
  password: process.env.DB_PASSWORD || '123456',
  port: process.env.DB_PORT || 5432,
});

// Configurações do Telegram
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8588696043:AAGPRLDK9mAIWxaSgv95IKVuZyK6C3nzJzg';

// Variável para controle de polling
let lastUpdateId = 0;
let isPolling = false;

// Função para enviar mensagens para o Telegram
async function enviarParaTelegram(tecnicoId, chamado) {
  try {
    // Buscar o chatId do técnico no banco
    const result = await pool.query(
      'SELECT telegram_chat_id, nome FROM tecnicos WHERE id = $1',
      [tecnicoId]
    );

    if (result.rows.length === 0 || !result.rows[0].telegram_chat_id) {
      console.log(`⚠️ Técnico ${tecnicoId} não possui telegram_chat_id configurado`);
      return;
    }

    const chatId = result.rows[0].telegram_chat_id;

    // Buscar o nome do setor
    const setorResult = await pool.query(
      'SELECT nome FROM setores WHERE id = $1',
      [chamado.setor_id]
    );
    
    const setorNome = setorResult.rows.length > 0 ? setorResult.rows[0].nome : 'Setor não encontrado';

    const mensagem = `🚨 *NOVO CHAMADO DESIGNADO* 🚨

👤 *Solicitante:* ${chamado.usuario_nome}
🏢 *Local:* ${setorNome}
📋 *Problema:* ${chamado.descricao}
👨‍💻 *Técnico Designado:* ${result.rows[0].nome}
🔢 *Número do Chamado:* #${chamado.id}
⏰ *Data/Hora:* ${new Date(chamado.data_abertura).toLocaleString('pt-BR')}

--------------------------------

💡 *PARA FECHAR ESTE CHAMADO:*

Envie uma mensagem com:
Problema: [descrição do problema]
Solução: [descrição da solução]

*Exemplo:*
Problema: Computador não ligava
Solução: Troquei a fonte de alimentação`;

    console.log(`📤 Enviando mensagem para chatId: ${chatId}, Técnico: ${result.rows[0].nome}`);

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: mensagem,
      parse_mode: 'Markdown'
    });

    // Marcar como aguardando solução
    await pool.query(
      'UPDATE chamados SET aguardando_solucao = TRUE WHERE id = $1',
      [chamado.id]
    );

    console.log(`✅ Notificação enviada e chamado #${chamado.id} marcado como aguardando solução`);

  } catch (error) {
    console.error('❌ Erro ao enviar para Telegram:', error.response?.data || error.message);
  }
}

// Função auxiliar para enviar mensagens
async function enviarMensagemTelegram(chatId, texto) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: texto,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
  }
}

// Função para verificar mensagens do Telegram periodicamente
async function checkTelegramMessages() {
  if (isPolling) return;
  isPolling = true;

  try {
    const response = await axios.get(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=10`
    );
    
    if (response.data.ok && response.data.result.length > 0) {
      console.log(`📨 ${response.data.result.length} mensagem(s) recebida(s)`);
      
      for (const update of response.data.result) {
        lastUpdateId = update.update_id;
        
        if (update.message) {
          await processTelegramMessage(update.message);
        }
      }
    }
  } catch (error) {
    console.error('❌ Erro ao verificar mensagens:', error.message);
  } finally {
    isPolling = false;
  }
}

// Função para processar mensagens do Telegram
async function processTelegramMessage(message) {
  const chatId = message.chat.id;
  const text = message.text ? message.text.trim() : '';
  const messageId = message.message_id;

  console.log(`💬 Mensagem de ${chatId}: "${text}"`);

  try {
    // Verificar se é um comando
    if (text.startsWith('/')) {
      await processarComando(chatId, text);
      return;
    }

    // Buscar técnico pelo chat_id
    const tecnicoResult = await pool.query(
      'SELECT id, nome FROM tecnicos WHERE telegram_chat_id = $1',
      [chatId.toString()]
    );

    if (tecnicoResult.rows.length === 0) {
      console.log(`⚠️ Chat ID ${chatId} não está associado a nenhum técnico`);
      await enviarMensagemTelegram(chatId, '❌ Você não está registrado como técnico. Use /registrar para se cadastrar.');
      return;
    }

    const tecnico = tecnicoResult.rows[0];

    // Buscar chamados pendentes do técnico
    const chamadosPendentes = await pool.query(
      `SELECT * FROM chamados 
       WHERE tecnico_id = $1 
       AND aguardando_solucao = TRUE 
       AND status = 'em_andamento'
       ORDER BY data_abertura DESC 
       LIMIT 1`,
      [tecnico.id]
    );

    if (chamadosPendentes.rows.length === 0) {
      await enviarMensagemTelegram(chatId, '📋 Você não possui chamados pendentes para fechar.');
      return;
    }

    const chamado = chamadosPendentes.rows[0];
    await processarRespostaChamado(chamado.id, text, chatId);

  } catch (error) {
    console.error('❌ Erro ao processar mensagem:', error);
    await enviarMensagemTelegram(chatId, '❌ Erro ao processar sua mensagem. Tente novamente.');
  }
}

// Função para processar resposta de chamado
async function processarRespostaChamado(chamadoId, texto, chatId) {
  try {
    console.log(`🔧 Processando resposta para chamado #${chamadoId}: "${texto}"`);

    // Converter para minúsculas para facilitar o parsing
    const textoLower = texto.toLowerCase();
    
    let problema = '';
    let solucao = '';

    // Método 1: Buscar por marcadores explícitos
    if (textoLower.includes('problema') || textoLower.includes('solução')) {
      const linhas = texto.split('\n');
      let emProblema = false;
      let emSolucao = false;

      for (const linha of linhas) {
        const linhaLimpa = linha.trim();
        const linhaLower = linhaLimpa.toLowerCase();
        
        if (linhaLower.startsWith('problema')) {
          emProblema = true;
          emSolucao = false;
          problema += linhaLimpa.replace(/^problema:?\s*/i, '').trim() + '\n';
        } 
        else if (linhaLower.startsWith('solução') || linhaLower.startsWith('solucao')) {
          emProblema = false;
          emSolucao = true;
          solucao += linhaLimpa.replace(/^(solução|solucao):?\s*/i, '').trim() + '\n';
        }
        else if (emProblema) {
          problema += linhaLimpa + '\n';
        }
        else if (emSolucao) {
          solucao += linhaLimpa + '\n';
        }
      }
    }
    
    // Método 2: Se não encontrou marcadores, tentar dividir por linhas
    if (!problema.trim() && !solucao.trim()) {
      console.log('⚠️ Usando método alternativo de parsing');
      
      const linhas = texto.split('\n').filter(linha => linha.trim().length > 0);
      
      if (linhas.length >= 2) {
        problema = linhas[0].replace(/^[-•]\s*/, '').trim();
        solucao = linhas[1].replace(/^[-•]\s*/, '').trim();
      } else if (linhas.length === 1) {
        solucao = linhas[0].trim();
        problema = 'Problema não especificado';
      }
    }

    // Limpar e validar
    problema = problema.trim() || 'Problema não especificado';
    solucao = solucao.trim();

    if (!solucao) {
      throw new Error('Solução não fornecida');
    }

    console.log(`📝 Problema extraído: "${problema}"`);
    console.log(`✅ Solução extraída: "${solucao}"`);

    // Fechar o chamado
    await pool.query(
      'UPDATE chamados SET status = $1, problema = $2, solucao = $3, data_fechamento = CURRENT_TIMESTAMP, aguardando_solucao = FALSE WHERE id = $4',
      ['fechado', problema, solucao, chamadoId]
    );

    // Enviar confirmação
    await enviarMensagemTelegram(
      chatId,
      `✅ *CHAMADO FECHADO COM SUCESSO!* ✅\n\n` +
      `*Chamado:* #${chamadoId}\n` +
      `*Problema:* ${problema}\n` +
      `*Solução:* ${solucao}\n\n` +
      `O chamado foi registrado como concluído.`
    );

    console.log(`✅ Chamado ${chamadoId} fechado via Telegram`);

  } catch (error) {
    console.error('❌ Erro ao processar resposta:', error);
    await enviarMensagemTelegram(
      chatId,
      '❌ *ERRO AO PROCESSAR RESPOSTA*\n\n' +
      'Formato incorreto. Use:\n\n' +
      '```\n' +
      'Problema: [descrição do problema]\n' +
      'Solução: [solução aplicada]\n' +
      '```\n\n' +
      '*Exemplo:*\n' +
      'Problema: Computador não ligava\n' +
      'Solução: Troquei a fonte de alimentação'
    );
  }
}

// Processar registro do técnico
async function processarRegistro(chatId) {
  try {
    // Buscar técnico pelo chat_id para ver se já está registrado
    const tecnicoExistente = await pool.query(
      'SELECT id, nome FROM tecnicos WHERE telegram_chat_id = $1',
      [chatId.toString()]
    );

    if (tecnicoExistente.rows.length > 0) {
      await enviarMensagemTelegram(
        chatId,
        `✅ Você já está registrado como: ${tecnicoExistente.rows[0].nome}`
      );
      return;
    }

    // Listar técnicos disponíveis para registro
    const tecnicos = await pool.query(
      'SELECT id, nome FROM tecnicos WHERE telegram_chat_id IS NULL AND ativo = TRUE'
    );

    if (tecnicos.rows.length === 0) {
      await enviarMensagemTelegram(
        chatId,
        '❌ Não há técnicos disponíveis para registro. Entre em contato com o administrador.'
      );
      return;
    }

    let mensagem = `👥 *TÉCNICOS DISPONÍVEIS PARA VINCULAR:*\n\n`;
    
    tecnicos.rows.forEach((tecnico, index) => {
      mensagem += `${index + 1}. ${tecnico.nome}\n`;
    });

    mensagem += `\n*Para se registrar, responda:*\n`;
    mensagem += `"/vincular [número]"\n\n`;
    mensagem += `*Exemplo:* /vincular 1`;

    await enviarMensagemTelegram(chatId, mensagem);

  } catch (error) {
    console.error('Erro no registro:', error);
    await enviarMensagemTelegram(chatId, '❌ Erro no processo de registro.');
  }
}

// Processar vinculação
async function processarVinculacao(chatId, texto) {
  try {
    const match = texto.match(/\/vincular\s+(\d+)/);
    if (!match) {
      await enviarMensagemTelegram(chatId, '❌ Formato incorreto. Use: /vincular [número]');
      return;
    }

    const numero = parseInt(match[1]);
    
    const tecnicos = await pool.query(
      'SELECT id, nome FROM tecnicos WHERE telegram_chat_id IS NULL AND ativo = TRUE'
    );

    if (numero < 1 || numero > tecnicos.rows.length) {
      await enviarMensagemTelegram(chatId, '❌ Número inválido. Use um número da lista.');
      return;
    }

    const tecnico = tecnicos.rows[numero - 1];
    
    await pool.query(
      'UPDATE tecnicos SET telegram_chat_id = $1 WHERE id = $2',
      [chatId.toString(), tecnico.id]
    );

    await enviarMensagemTelegram(
      chatId,
      `✅ *REGISTRO CONCLUÍDO!*\n\n` +
      `Você foi vinculado como: *${tecnico.nome}*\n\n` +
      `Agora você receberá notificações de novos chamados!`
    );

    console.log(`✅ Técnico ${tecnico.nome} vinculado ao chat ID ${chatId}`);

  } catch (error) {
    console.error('Erro na vinculação:', error);
    await enviarMensagemTelegram(chatId, '❌ Erro ao processar vinculação.');
  }
}

// Função para processar comandos normais
async function processarComando(chatId, texto) {
  const comando = texto.toLowerCase();

  if (comando === '/start' || comando === '/ajuda') {
    await enviarMensagemTelegram(
      chatId,
      `🤖 *BOT DE SUPORTE TÉCNICO* 🤖\n\n` +
      `*Comandos disponíveis:*\n` +
      `/registrar - Vincular este chat ao seu usuário\n` +
      `/chamados - Listar meus chamados em aberto\n` +
      `/ajuda - Mostrar esta ajuda\n\n` +
      `*Para fechar um chamado:*\n` +
      `Envie a descrição do problema e solução\n` +
      `*Exemplo:*\n` +
      `Problema: Computador não ligava\n` +
      `Solução: Troquei a fonte de alimentação`
    );
  } 
  else if (comando === '/registrar') {
    await processarRegistro(chatId);
  }
  else if (comando.startsWith('/vincular')) {
    await processarVinculacao(chatId, texto);
  }
  else if (comando === '/chamados') {
    await listarChamadosTecnico(chatId);
  }
  else {
    await enviarMensagemTelegram(
      chatId,
      `❓ Comando não reconhecido. Use /ajuda para ver os comandos disponíveis.`
    );
  }
}

// Listar chamados do técnico
async function listarChamadosTecnico(chatId) {
  try {
    const result = await pool.query(
      `SELECT c.id, c.titulo, c.descricao, c.status, c.data_abertura, s.nome as setor
       FROM chamados c 
       JOIN tecnicos t ON c.tecnico_id = t.id 
       JOIN setores s ON c.setor_id = s.id
       WHERE t.telegram_chat_id = $1 AND c.status != 'fechado'
       ORDER BY c.data_abertura DESC`,
      [chatId]
    );

    if (result.rows.length === 0) {
      await enviarMensagemTelegram(chatId, '📋 Você não possui chamados em aberto.');
      return;
    }

    let mensagem = '📋 *SEUS CHAMADOS EM ABERTO:*\n\n';
    
    result.rows.forEach((chamado, index) => {
      mensagem += `*Chamado #${chamado.id}* - ${chamado.titulo}\n`;
      mensagem += `Setor: ${chamado.setor}\n`;
      mensagem += `Status: ${chamado.status}\n`;
      mensagem += `Aberto em: ${new Date(chamado.data_abertura).toLocaleString('pt-BR')}\n`;
      mensagem += `--------------------------------\n\n`;
    });

    await enviarMensagemTelegram(chatId, mensagem);

  } catch (error) {
    console.error('Erro ao listar chamados:', error);
    await enviarMensagemTelegram(chatId, '❌ Erro ao carregar seus chamados.');
  }
}

// ==============================================
// ROTAS DE AUTENTICAÇÃO
// ==============================================

// Rota de login
app.post('/api/login', async (req, res) => {
  const { usuario, senha } = req.body;

  try {
    // Verificar se é o admin
    if (usuario === CREDENCIAIS.usuario && senha === CREDENCIAIS.senha) {
      req.session.autenticado = true;
      req.session.usuario = usuario;
      req.session.nivelAcesso = 'ADMIN';
      req.session.isAdmin = true;
      return res.json({ success: true, message: 'Login realizado com sucesso', isAdmin: true });
    }

    // Verificar se é um técnico
    const tecnicoResult = await pool.query(
      `SELECT t.id, t.nome, t.usuario_login, t.senha_hash, n.codigo_acesso as nivel_acesso
       FROM tecnicos t
       LEFT JOIN niveis_tecnico n ON t.nivel_id = n.id
       WHERE t.usuario_login = $1 AND t.ativo = TRUE`,
      [usuario]
    );

    if (tecnicoResult.rows.length > 0) {
      const tecnico = tecnicoResult.rows[0];
      
      // Verificar senha com bcrypt
      if (tecnico.senha_hash) {
        const senhaValida = await bcrypt.compare(senha, tecnico.senha_hash);
        if (senhaValida) {
          req.session.autenticado = true;
          req.session.usuario = tecnico.nome;
          req.session.usuarioId = tecnico.id;
          req.session.nivelAcesso = tecnico.nivel_acesso;
          req.session.isAdmin = false;
          
          return res.json({ 
            success: true, 
            message: 'Login realizado com sucesso', 
            isAdmin: false,
            nivelAcesso: tecnico.nivel_acesso,
            usuario: tecnico.nome,
            usuarioId: tecnico.id
          });
        }
      }
      
      // Se não tem senha_hash ou a senha não confere, verificar senha padrão
      if (senha === 'senha123') {
        req.session.autenticado = true;
        req.session.usuario = tecnico.nome;
        req.session.usuarioId = tecnico.id;
        req.session.nivelAcesso = tecnico.nivel_acesso;
        req.session.isAdmin = false;
        
        return res.json({ 
          success: true, 
          message: 'Login realizado com sucesso', 
          isAdmin: false,
          nivelAcesso: tecnico.nivel_acesso,
          usuario: tecnico.nome,
          usuarioId: tecnico.id
        });
      }
    }

    // Se não encontrou usuário ou senha incorreta
    res.status(401).json({ success: false, error: 'Credenciais inválidas' });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});
// Rota de logout
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Erro ao fazer logout' });
    }
    res.json({ success: true, message: 'Logout realizado com sucesso' });
  });
});

// Rota para verificar autenticação
app.get('/api/auth/status', (req, res) => {
  res.json({ 
    autenticado: !!req.session.autenticado,
    usuario: req.session.usuario,
    usuarioId: req.session.usuarioId || null,
    isAdmin: req.session.isAdmin || false,
    nivelAcesso: req.session.nivelAcesso || null
  });
});

// ==============================================
// ROTAS DA API
// ==============================================

// Obter todos os técnicos (modificado)
app.get('/api/tecnicos', async (req, res) => { 
  try {
    const query = `
      SELECT t.*, n.nome as nivel_nome, n.descricao as nivel_descricao, n.codigo_acesso
      FROM tecnicos t 
      LEFT JOIN niveis_tecnico n ON t.nivel_id = n.id 
      WHERE t.ativo = TRUE 
      ORDER BY t.nome
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar técnicos' });
  }
});

// Obter todos os setores
app.get('/api/setores', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM setores ORDER BY nome');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar setores' });
  }
});

// Criar um novo chamado (modificado)
app.post('/api/chamados', async (req, res) => {
  const { usuario_nome, descricao, setor_id, titulo } = req.body;
  
  try {
    // Inserir chamado sem técnico designado (status: 'aberto')
     const result = await pool.query(
      `INSERT INTO chamados (usuario_nome, titulo, descricao, setor_id, status) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [usuario_nome, titulo, descricao, setor_id, 'aberto']
    );
    
    const chamado = result.rows[0];
    res.json(chamado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar chamado' });
  }
});
// Obter um chamado específico (ADICIONE ESTA ROTA)
app.get('/api/chamados/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        const result = await pool.query(`
            SELECT c.*, t.nome as tecnico_nome, s.nome as setor_nome,
                   ta.nome as tecnico_anterior_nome
            FROM chamados c
            LEFT JOIN tecnicos t ON c.tecnico_id = t.id
            LEFT JOIN setores s ON c.setor_id = s.id
            LEFT JOIN tecnicos ta ON c.tecnico_anterior_id = ta.id
            WHERE c.id = $1
        `, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Chamado não encontrado' });
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao buscar chamado' });
    }
});


// Designar técnico a um chamado (nova rota)
app.put('/api/chamados/:id/designar', async (req, res) => {
  const { id } = req.params;
  const { tecnico_id } = req.body;
  
  try {
    const result = await pool.query(
      'UPDATE chamados SET tecnico_id = $1, status = $2 WHERE id = $3 RETURNING *',
      [tecnico_id, 'em_andamento', id]
    );
    
    const chamado = result.rows[0];
    
    // Buscar informações completas para notificação
    const chamadoCompleto = await pool.query(`
      SELECT c.*, t.nome as tecnico_nome, s.nome as setor_nome
      FROM chamados c
      LEFT JOIN tecnicos t ON c.tecnico_id = t.id
      LEFT JOIN setores s ON c.setor_id = s.id
      WHERE c.id = $1
    `, [chamado.id]);
    
    // Enviar notificação para o Telegram
    if (chamadoCompleto.rows[0].tecnico_id) {
      enviarParaTelegram(tecnico_id, chamadoCompleto.rows[0]).catch(console.error);
    }
    
    res.json(chamado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao designar técnico' });
  }
});

// Obter todos os chamados com filtros (MODIFICADO)
app.get('/api/chamados', async (req, res) => {
  try {
    const { status } = req.query;
    
    // Verificar se o usuário está autenticado e seu nível de acesso
    const isAdmin = req.session.isAdmin || false;
    const nivelAcesso = req.session.nivelAcesso;
    const usuarioId = req.session.usuarioId;
    
    let query = `
      SELECT c.*, t.nome as tecnico_nome, s.nome as setor_nome, 
             ta.nome as tecnico_anterior_nome
      FROM chamados c
      LEFT JOIN tecnicos t ON c.tecnico_id = t.id
      LEFT JOIN setores s ON c.setor_id = s.id
      LEFT JOIN tecnicos ta ON c.tecnico_anterior_id = ta.id
    `;
    
    let params = [];
    let whereConditions = [];
    
    // Aplicar filtro de nível de acesso
    if (!isAdmin && nivelAcesso && ['N1', 'N2'].includes(nivelAcesso) && usuarioId) {
      // Para N1 e N2: mostrar apenas chamados designados para eles
      whereConditions.push('(c.tecnico_id = $1 OR c.status = $2)');
      params.push(usuarioId, 'aberto');
    }
    
    // Aplicar filtro de status se fornecido
    if (status) {
      whereConditions.push('c.status = $' + (params.length + 1));
      params.push(status);
    }
    
    // Combinar condições WHERE
    if (whereConditions.length > 0) {
      query += ' WHERE ' + whereConditions.join(' AND ');
    }
    
    query += ' ORDER BY c.data_abertura DESC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar chamados' });
  }
});

// Atualizar um chamado
app.put('/api/chamados/:id', async (req, res) => {
  const { id } = req.params;
  const { status, problema, solucao, tecnico_id } = req.body;
  
  try {
    let query = '';
    let values = [];
    
    if (status === 'fechado') {
      query = 'UPDATE chamados SET status = $1, problema = $2, solucao = $3, data_fechamento = CURRENT_TIMESTAMP WHERE id = $4 RETURNING *';
      values = [status, problema, solucao, id];
    } else if (status === 'redirecionado') {
      // Primeiro, obtenha o técnico atual para salvar como anterior
      const chamadoAtual = await pool.query('SELECT tecnico_id FROM chamados WHERE id = $1', [id]);
      const tecnicoAnteriorId = chamadoAtual.rows[0].tecnico_id;
      
      query = 'UPDATE chamados SET status = $1, tecnico_anterior_id = $2, tecnico_id = $3 WHERE id = $4 RETURNING *';
      values = ['em_andamento', tecnicoAnteriorId, tecnico_id, id];
    } else {
      query = 'UPDATE chamados SET status = $1 WHERE id = $2 RETURNING *';
      values = [status, id];
    }
    
    const result = await pool.query(query, values);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar chamado' });
  }
});

// Gerenciamento de Técnicos

// Obter todos os técnicos (incluindo inativos) - modificado
app.get('/api/tecnicos/todos', async (req, res) => {
  try {
    const query = `
      SELECT t.*, n.nome as nivel_nome, n.descricao as nivel_descricao, n.codigo_acesso
      FROM tecnicos t 
      LEFT JOIN niveis_tecnico n ON t.nivel_id = n.id 
      ORDER BY t.nome
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar técnicos' });
  }
});

// Criar um novo técnico
app.post('/api/tecnicos', async (req, res) => {
  const { nome, whatsapp, nivel_id, usuario_login } = req.body;
  
  try {
    // Gerar um nome de usuário padrão se não fornecido
    const login = usuario_login || nome.toLowerCase().replace(/\s+/g, '.');
    
    const result = await pool.query(
      'INSERT INTO tecnicos (nome, whatsapp, nivel_id, usuario_login) VALUES ($1, $2, $3, $4) RETURNING *',
      [nome, whatsapp, nivel_id || 1, login]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar técnico' });
  }
});

// Atualizar um técnico
app.put('/api/tecnicos/:id', async (req, res) => {
  const { id } = req.params;
  const { nome, whatsapp, nivel_id, ativo } = req.body;
  
  try {
    const result = await pool.query(
      'UPDATE tecnicos SET nome = $1, whatsapp = $2, nivel_id = $3, ativo = $4 WHERE id = $5 RETURNING *',
      [nome, whatsapp, nivel_id, ativo, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar técnico' });
  }
});
// Excluir um técnico (exclusão lógica)
app.delete('/api/tecnicos/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    // Verificar se o técnico está atribuído a algum chamado em andamento
    const chamadosResult = await pool.query(
      'SELECT COUNT(*) FROM chamados WHERE tecnico_id = $1 AND status != $2',
      [id, 'fechado']
    );
    
    if (parseInt(chamadosResult.rows[0].count) > 0) {
      return res.status(400).json({ 
        error: 'Não é possível excluir o técnico pois existem chamados em andamento atribuídos a ele.' 
      });
    }
    
    // Fazer exclusão lógica
    const result = await pool.query(
      'UPDATE tecnicos SET ativo = FALSE WHERE id = $1 RETURNING *',
      [id]
    );
    res.json({ message: 'Técnico excluído com sucesso', tecnico: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao excluir técnico' });
  }
});

// Gerenciamento de Setores

// Obter todos os setores (incluindo inativos)
app.get('/api/setores/todos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM setores ORDER BY nome');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar setores' });
  }
});

// Criar um novo setor
app.post('/api/setores', async (req, res) => {
  const { nome, descricao } = req.body;
  
  try {
    const result = await pool.query(
      'INSERT INTO setores (nome, descricao) VALUES ($1, $2) RETURNING *',
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar setor' });
  }
});

// Atualizar um setor
app.put('/api/setores/:id', async (req, res) => {
  const { id } = req.params;
  const { nome, descricao, ativo } = req.body;
  
  try {
    const result = await pool.query(
      'UPDATE setores SET nome = $1, descricao = $2, ativo = $3 WHERE id = $4 RETURNING *',
      [nome, descricao, ativo, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar setor' });
  }
});

// Excluir um setor (exclusão lógica)
app.delete('/api/setores/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    // Verificar se o setor está atribuído a algum chamado
    const chamadosResult = await pool.query(
      'SELECT COUNT(*) FROM chamados WHERE setor_id = $1',
      [id]
    );
    
    if (parseInt(chamadosResult.rows[0].count) > 0) {
      return res.status(400).json({ 
        error: 'Não é possível excluir o setor pois existem chamados atribuídos a ele.' 
      });
    }
    
    // Fazer exclusão lógica
    const result = await pool.query(
      'UPDATE setores SET ativo = FALSE WHERE id = $1 RETURNING *',
      [id]
    );
    res.json({ message: 'Setor excluído com sucesso', setor: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao excluir setor' });
  }
});

// Obter todos os níveis de técnicos
app.get('/api/niveis-tecnico', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM niveis_tecnico ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar níveis de técnico' });
  }
});

// Atualizar a rota de criação de técnico
app.post('/api/tecnicos', async (req, res) => {
  const { nome, whatsapp, nivel_id } = req.body;
  
  try {
    const result = await pool.query(
      'INSERT INTO tecnicos (nome, whatsapp, nivel_id) VALUES ($1, $2, $3) RETURNING *',
      [nome, whatsapp, nivel_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar técnico' });
  }
});

// Atualizar um técnico
app.put('/api/tecnicos/:id', async (req, res) => {
  const { id } = req.params;
  const { nome, whatsapp, nivel_id, ativo, usuario_login } = req.body;
  
  try {
    const result = await pool.query(
      'UPDATE tecnicos SET nome = $1, whatsapp = $2, nivel_id = $3, ativo = $4, usuario_login = $5 WHERE id = $6 RETURNING *',
      [nome, whatsapp, nivel_id, ativo, usuario_login, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar técnico' });
  }
});

// Rota para alterar senha do técnico
app.put('/api/tecnicos/:id/senha', async (req, res) => {
  const { id } = req.params;
  const { senhaAtual, novaSenha } = req.body;
  
  try {
    // Verificar se o usuário tem permissão para alterar esta senha
    if (req.session.usuarioId !== parseInt(id) && !req.session.isAdmin) {
      return res.status(403).json({ error: 'Permissão negada' });
    }
    
    // Buscar técnico
    const tecnicoResult = await pool.query(
      'SELECT * FROM tecnicos WHERE id = $1',
      [id]
    );
    
    if (tecnicoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Técnico não encontrado' });
    }
    
    const tecnico = tecnicoResult.rows[0];
    
    // Verificar senha atual
    if (tecnico.senha_hash) {
      // Se já tem senha hash, verificar com bcrypt
      const senhaAtualValida = await bcrypt.compare(senhaAtual, tecnico.senha_hash);
      if (!senhaAtualValida) {
        return res.status(401).json({ error: 'Senha atual incorreta' });
      }
    } else {
      // Se não tem senha hash, verificar senha padrão
      if (senhaAtual !== 'senha123') {
        return res.status(401).json({ error: 'Senha atual incorreta' });
      }
    }
    
    // Hash da nova senha
    const saltRounds = 10;
    const senhaHash = await bcrypt.hash(novaSenha, saltRounds);
    
    // Atualizar senha no banco
    await pool.query(
      'UPDATE tecnicos SET senha_hash = $1 WHERE id = $2',
      [senhaHash, id]
    );
    
    res.json({ success: true, message: 'Senha alterada com sucesso' });
    
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao alterar senha' });
  }
});
// Rota para testar o Telegram
app.get('/api/test-telegram', async (req, res) => {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN || '8138818688:AAElano-FkgxWUu_KKbMkugJXiO9HRJl1Cw';
    const response = await axios.get(`https://api.telegram.org/bot${token}/getMe`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

// Iniciar polling a cada 3 segundos
setInterval(checkTelegramMessages, 3000);

// Iniciar o servidor em modo rede
app.listen(port, host, () => {
  console.log(`🚀 Servidor rodando em http://${host}:${port}`);
  console.log(`🌐 Acessível em rede local`);
  console.log(`📱 Acesso externo: http://[SEU-IP]:${port}`);
  console.log(`🔐 Sistema de autenticação ativo`);
 
});