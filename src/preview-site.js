'use strict'

function createPreviewSite(deps = {}) {
  const {
    axios,
    logger,
    OPENAI_KEY,
    chamarClaudeAuxiliar,
    enviarImagemBase64,
    enviarMensagem,
    registrarEventoComercial,
    normalizarHistoricoMensagens,
    textoDeContent,
    limparBase64String,
    mimeImagemParaClaude,
  } = deps

  const PREVIEW_SITE_MODELOS = new Set(['iniciante', 'padrao', 'premium'])  
    
  function caseDeReferenciaPorNicho(negocio) {  
    const n = String(negocio || '').toLowerCase()  
    if (/(vidro|vidrac|esquadria)/i.test(n)) {  
      return { nome: '874 Vidros', cidade: 'Petrolina-PE', dado: '+93,8% de crescimento em acessos no Google em 30 dias' }  
    }  
    if (/(barber|barbearia|barbear)/i.test(n)) {  
      return { nome: 'Hokage Barber', cidade: 'Sao Bernardo-SP', dado: 'agendamento pelo WhatsApp ativo' }  
    }  
    if (/(foto|fotografi)/i.test(n)) {  
      return { nome: 'Mirelly Fotografias', cidade: '', dado: 'portfolio completo com galeria' }  
    }  
    if (/limpeza/i.test(n)) {  
      return { nome: 'Gurgel Clean', cidade: 'BH', dado: 'presenca profissional no Google' }  
    }  
    return { nome: '874 Vidros', cidade: 'Petrolina-PE', dado: '+93,8% de crescimento em acessos no Google em 30 dias' }  
  }  
    
  function montarPreviewSiteCaption(dados) {  
    const negocio = textoCurto(dados?.negocio || 'seu negocio', 70)  
    const ref = caseDeReferenciaPorNicho(negocio)  
    const cidade = ref.cidade ? `, em ${ref.cidade},` : ''  
    return [  
      'Fiz uma previa estrategica pra voce visualizar como poderia ficar a presenca online da sua empresa.',  
      `Ainda nao e o site final: e uma amostra de direcao para mostrar como ${negocio} poderia ser apresentado online pra atrair cliente e chamar no WhatsApp.`,  
      `O site real fica com nivel de acabamento profissional, igual aos projetos que ja entregamos. Um exemplo e a ${ref.nome}${cidade} que teve ${ref.dado}.`,  
      'Posso te mandar o link pra voce ver na pratica e nao ficar so na promessa?',  
    ].join('\n')  
  }  
    
  /**  
   * Caption IA da imagem da previa de site enviada ao lead via WhatsApp.  
   * Cai para `montarPreviewSiteCaption(dadosPreview)` quando ANTHROPIC_KEY ausente  
   * ou a chamada falha — preserva enquadramento "previa estrategica".  
   */  
  async function gerarCaptionPreview(perfil = {}, dadosPreview = {}, numero = null) {  
    const negocio = textoCurto(perfil?.negocio || dadosPreview?.negocio || 'seu negocio', 70)  
    const cidade = textoCurto(perfil?.cidade || dadosPreview?.cidade || '', 70)  
    const modelo = String(dadosPreview?.modelo || perfil?.plano_sugerido || 'padrao').trim()  
    const ref = caseDeReferenciaPorNicho(negocio)  
    const system =  
      `Voce e o assistente de vendas da PJ Codeworks. Acabou de enviar a IMAGEM de uma previa estrategica do site para o WhatsApp do lead. Escreva a CAPTION da imagem.\n` +  
      `OBJETIVO: enquadrar a previa como amostra de direcao (nao site final), reforcar profissionalismo da entrega real e fechar com pergunta natural.\n` +  
      `REGRAS:\n` +  
      `- Tom de WhatsApp humano, nao vendedor agressivo.\n` +  
      `- Ate 4 frases curtas em paragrafos (separe com \\n). Maximo 600 caracteres no total.\n` +  
      `- Sem markdown, sem bullets, sem placeholders entre colchetes.\n` +  
      `- Use o nicho e a cidade reais (nao invente), mas pode citar o case de referencia abaixo se ajudar a ancorar autoridade.\n` +  
      `- NAO prometa primeira posicao no Google nem percentuais de crescimento alem do case citado.\n` +  
      `- Termine com UMA pergunta natural pra abrir o proximo turno.\n` +  
      `- Retorne APENAS o texto da caption, sem aspas, sem JSON, sem prefixo.`  
    const user =  
      `Contexto:\n` +  
      `- nicho: ${negocio}\n` +  
      `- cidade: ${cidade || '(nao coletada)'}\n` +  
      `- modelo da previa: ${modelo}\n` +  
      `- case de referencia autorizado para citar (opcional): ${ref.nome}${ref.cidade ? `, em ${ref.cidade},` : ''} teve ${ref.dado}\n\n` +  
      `Gere a caption da imagem da previa.`  
    const r = await chamarClaudeAuxiliar({  
      tipo: 'caption_preview',  
      numero,  
      estagio: 'proposta',  
      system,  
      userMessage: user,  
      max_tokens: 400,  
      temperature: 0.5,  
      metadata: { modelo },  
    })  
    if (!r.ok || !r.texto) return montarPreviewSiteCaption(dadosPreview || perfil || {})  
    const limpo = r.texto.replace(/^["'`]+|["'`]+$/g, '').trim()  
    if (!limpo || limpo.length > 900) return montarPreviewSiteCaption(dadosPreview || perfil || {})  
    return limpo  
  }  
    
  function escapeHtml(s) {  
    return String(s == null ? '' : s)  
      .replace(/&/g, '&amp;')  
      .replace(/</g, '&lt;')  
      .replace(/>/g, '&gt;')  
      .replace(/"/g, '&quot;')  
      .replace(/'/g, '&#39;')  
  }  
    
  function escapeXml(s) {  
    return escapeHtml(s)  
  }  
    
  function textoCurto(raw, max = 80) {  
    const t = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim()  
    if (!t) return ''  
    return t.length > max ? `${t.slice(0, Math.max(0, max - 1)).trim()}...` : t  
  }  
    
  function moedaPtBr(valor) {  
    const n = Number(valor)  
    if (!Number.isFinite(n) || n <= 0) return ''  
    return `R$ ${Math.round(n).toLocaleString('pt-BR')}`  
  }  
    
  function modeloPreviewSite(perfil, opcoes = {}) {  
    const raw = String(opcoes.modelo || perfil?.plano_sugerido || perfil?.precificacao_json?.plano_recomendado || 'padrao')  
      .trim()  
      .toLowerCase()  
    return PREVIEW_SITE_MODELOS.has(raw) ? raw : 'padrao'  
  }  
    
  function extrairServicosDoHistorico(historico, perfil) {  
    const base = []  
    const negocio = String(perfil?.negocio || '').toLowerCase()  
    const mapa = [  
      ['vidro', ['Box para banheiro', 'Esquadrias sob medida', 'Fechamento de sacadas']],  
      ['vidrac', ['Box para banheiro', 'Esquadrias sob medida', 'Fechamento de sacadas']],  
      ['esquadria', ['Esquadrias sob medida', 'Portas e janelas', 'Projetos em aluminio']],  
      ['pintura', ['Pintura residencial', 'Pintura predial', 'Acabamento profissional']],  
      ['barbear', ['Cortes masculinos', 'Barba completa', 'Agendamento pelo WhatsApp']],  
      ['estet', ['Procedimentos esteticos', 'Avaliacao personalizada', 'Atendimento com hora marcada']],  
      ['dent', ['Consultas odontologicas', 'Tratamentos esteticos', 'Agendamento rapido']],  
      ['veterin', ['Consultas veterinarias', 'Vacinas e exames', 'Atendimento com carinho']],  
      ['foto', ['Ensaios fotograficos', 'Eventos', 'Portfolio profissional']],  
      ['limpeza', ['Higienizacao de estofados', 'Limpeza residencial', 'Orcamento pelo WhatsApp']],  
    ]  
    for (const [needle, servs] of mapa) {  
      if (negocio.includes(needle)) base.push(...servs)  
    }  
    
    const texto = normalizarHistoricoMensagens(historico)  
      .filter((m) => m.role === 'user')  
      .slice(-8)  
      .map((m) => textoDeContent(m.content))  
      .join(' ')  
      .toLowerCase()  
    
    const candidatos = [  
      'landing page',  
      'site institucional',  
      'orcamento pelo whatsapp',  
      'agendamento',  
      'google',  
      'servicos',  
      'produtos',  
      'portfolio',  
    ]  
    for (const c of candidatos) {  
      if (texto.includes(c)) base.push(c.replace(/\b\w/g, (x) => x.toUpperCase()))  
    }  
    
    const limpos = [...new Set(base.map((s) => textoCurto(s, 42)).filter(Boolean))]  
    return limpos.length ? limpos.slice(0, 4) : ['Servicos principais', 'Fotos dos trabalhos', 'Botao direto para WhatsApp']  
  }  
    
  function dadosPreviewSite(numero, perfil, historico, opcoes = {}) {  
    const modelo = modeloPreviewSite(perfil, opcoes)  
    const negocio = textoCurto(perfil?.negocio || opcoes.negocio || 'Seu negocio', 48)  
    const cidade = textoCurto(perfil?.cidade || opcoes.cidade || 'sua cidade', 48)  
    const servicos = Array.isArray(opcoes.servicos) && opcoes.servicos.length  
      ? opcoes.servicos.map((s) => textoCurto(s, 42)).filter(Boolean).slice(0, 4)  
      : extrairServicosDoHistorico(historico, perfil)  
    const total = moedaPtBr(perfil?.preco_calculado)  
    const entrada = moedaPtBr(perfil?.entrada)  
    const parcela = moedaPtBr(perfil?.parcela)  
    const phone = String(numero || '').replace(/@s\.whatsapp\.net$/i, '').replace(/\D/g, '')  
    const imagens = Array.isArray(opcoes.imagens)  
      ? opcoes.imagens  
          .filter((img) => img && typeof img.data === 'string' && img.data.trim())  
          .map((img) => ({  
            media_type: mimeImagemParaClaude(img.media_type || img.mimetype || 'image/jpeg') || 'image/jpeg',  
            data: limparBase64String(img.data),  
          }))  
          .filter((img) => img.data)  
          .slice(0, 4)  
      : []  
    return { modelo, negocio, cidade, servicos, total, entrada, parcela, phone, imagens }  
  }  
    
  function montarPromptWireframe(dados, estilo = 'lapis') {  
    const servicos = dados.servicos.slice(0, 4).join(', ')  
    const neg = dados.negocio  
    const cid = dados.cidade  
    
    const base = `Website prototype wireframe for a Brazilian business.  
  Business: "${neg}", city: ${cid}.  
  Services: ${servicos}.  
  Layout (top to bottom):  
  1. Navigation bar: logo "${neg}" + 3 menu links (Servicos, Projetos, Contato)  
  2. Dark hero section: large heading "${neg} em ${cid}", subtitle about professional online presence, CTA button "Chamar no WhatsApp"  
  3. Social proof bar: 5 stars + "31 clientes atendidos"  
  4. Two columns: left = service list (${servicos}); right = 3 photo placeholder boxes with X marks  
  5. Footer: "PJCodeworks" brand  
  Portrait format 1024x1536.`  
    
    if (estilo === 'lapis') {  
      return `${base}  
  Style: hand-drawn pencil sketch on white paper, rough uneven lines, gray shading, no color fills, imperfect borders. Rotated stamp reading "RASCUNHO" in red. Looks like a quick paper mockup, clearly not a finished design.`  
    }  
    
    return `${base}  
  Style: clean digital wireframe, thin gray lines, solid gray placeholder boxes, minimal typography markers, white background. "DEMONSTRACAO" label at bottom. Professional low-fidelity prototype aesthetic.`  
  }  
    
  function escolherEstiloWireframe(dados, opcoes = {}) {  
    if (opcoes.estilo === 'clean' || opcoes.estilo === 'lapis') return opcoes.estilo  
    return 'lapis'  
  }  
    
  function montarPreviewSiteHtml(d) {  
    const modeloNome = d.modelo === 'premium' ? 'Premium' : d.modelo === 'iniciante' ? 'Iniciante' : 'Padrao'  
    const tema =  
      d.modelo === 'premium'  
        ? { bg: '#101820', accent: '#35d07f', soft: '#e9fff3' }  
        : d.modelo === 'iniciante'  
          ? { bg: '#16312b', accent: '#f0c85a', soft: '#fff7dc' }  
          : { bg: '#18212f', accent: '#38bdf8', soft: '#e7f7ff' }  
    const preco = d.total  
      ? `<div class="price">Modelo ${escapeHtml(modeloNome)} a partir de <b>${escapeHtml(d.total)}</b></div>`  
      : `<div class="price">Modelo ${escapeHtml(modeloNome)} - previa visual</div>`  
    const parcelamento = d.entrada && d.parcela ? `<span>${escapeHtml(d.entrada)} + 3x ${escapeHtml(d.parcela)}</span>` : ''  
    const fotos = d.imagens.length  
      ? d.imagens.map((img, i) => `<div class="photo"><img alt="Foto ${i + 1}" src="data:${img.media_type};base64,${img.data}"></div>`).join('')  
      : '<div class="photo placeholder">Foto do trabalho</div><div class="photo placeholder">Antes e depois</div><div class="photo placeholder">Equipe ou produto</div>'  
    return `<!doctype html>  
  <html lang="pt-BR">  
  <head>  
  <meta charset="utf-8">  
  <meta name="viewport" content="width=device-width, initial-scale=1">  
  <link rel="preconnect" href="https://fonts.googleapis.com">  
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>  
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800;900&display=swap" rel="stylesheet">  
  <style>  
  *{box-sizing:border-box}body{margin:0;background:#f5f7fb;font-family:'Inter',Arial,Helvetica,sans-serif;color:#172033}.wrap{width:1080px;height:1350px;background:#fff;overflow:hidden;position:relative}.hero{height:760px;padding:54px 76px 54px;background:linear-gradient(135deg,rgba(255,255,255,.20),rgba(255,255,255,0) 46%),${tema.bg};color:#fff;position:relative}.nav{height:58px;display:flex;align-items:center;justify-content:space-between;margin-bottom:58px}.logo{display:flex;align-items:center;gap:14px;font-size:23px;font-weight:900}.logo-mark{width:42px;height:42px;border-radius:12px;background:${tema.accent};box-shadow:0 14px 40px rgba(0,0,0,.18)}.menu{display:flex;gap:28px;color:#d7e0ec;font-size:20px;font-weight:700}.kicker{font-size:25px;text-transform:uppercase;letter-spacing:3px;color:${tema.accent};font-weight:800}.h1{font-size:74px;line-height:1;font-weight:900;max-width:830px;margin:24px 0 24px}.sub{font-size:31px;line-height:1.25;max-width:790px;color:#d7e0ec}.cta{display:inline-flex;align-items:center;gap:14px;margin-top:36px;background:${tema.accent};color:#07130f;border-radius:18px;padding:24px 32px;font-size:30px;font-weight:900}.badge{position:absolute;right:70px;top:150px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.24);border-radius:22px;padding:18px 22px;font-size:24px}.proof{height:88px;display:flex;align-items:center;gap:20px;padding:0 76px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-size:27px;font-weight:900;color:#172033}.stars{color:#f59e0b;letter-spacing:2px}.content{padding:44px 76px 0}.grid{display:grid;grid-template-columns:1.05fr .95fr;gap:36px}.card{border:1px solid #dce3ec;border-radius:18px;padding:28px;background:#fff}.card h2{margin:0 0 18px;font-size:34px}.services{display:grid;gap:13px}.service{font-size:26px;padding:18px 20px;background:${tema.soft};border-radius:14px;font-weight:800}.photos{display:grid;grid-template-columns:1fr 1fr;gap:14px}.photo{height:170px;border-radius:16px;overflow:hidden;background:linear-gradient(135deg,#172033,#475569);display:flex;align-items:center;justify-content:center;color:#e2e8f0;font-size:23px;font-weight:800;text-align:center;padding:18px}.photo:first-child{grid-column:span 2;height:210px}.photo img{width:100%;height:100%;object-fit:cover}.price{margin-top:28px;font-size:30px;font-weight:800}.price b{color:${tema.bg}}.demo-stamp{position:absolute;left:58px;bottom:102px;transform:rotate(-6deg);background:#f59e0b;color:#111827;border:4px solid #111827;border-radius:12px;padding:18px 24px;font-size:31px;font-weight:900;letter-spacing:1px;box-shadow:0 16px 32px rgba(15,23,42,.22)}.foot{position:absolute;left:0;right:0;bottom:0;height:78px;display:flex;justify-content:space-between;align-items:center;padding:0 76px;background:#101820;color:#e5e7eb;font-size:22px}.brand-foot{font-weight:900;color:#fff}.whats{color:#35d07f;font-weight:900}  
  </style>  
  </head>  
  <body>  
  <main class="wrap">  
    <section class="hero">  
      <div class="nav">  
        <div class="logo"><span class="logo-mark"></span><span>${escapeHtml(d.negocio)}</span></div>  
        <div class="menu"><span>Servicos</span><span>Projetos</span><span>Contato</span></div>  
      </div>  
      <div class="badge">Modelo ${escapeHtml(modeloNome)}</div>  
      <div class="kicker">${escapeHtml(d.cidade)}</div>  
      <div class="h1">${escapeHtml(d.negocio)} com presenca profissional no Google</div>  
      <div class="sub">Uma pagina clara para mostrar seus servicos, passar confianca e levar o cliente direto para o WhatsApp.</div>  
      <div class="cta">Chamar no WhatsApp</div>  
    </section>  
    <section class="proof"><span class="stars">★★★★★</span><span>31 clientes atendidos · Aparece no Google</span></section>  
    <section class="content">  
      <div class="grid">  
        <div class="card">  
          <h2>O que entraria na primeira versao</h2>  
          <div class="services">${d.servicos.map((s) => `<div class="service">${escapeHtml(s)}</div>`).join('')}</div>  
          ${preco}  
          ${parcelamento}  
        </div>  
        <div class="card">  
          <h2>Fotos e prova visual</h2>  
          <div class="photos">${fotos}</div>  
        </div>  
      </div>  
    </section>  
    <div class="demo-stamp">MODELO DE DEMONSTRACAO</div>  
    <div class="foot"><span class="brand-foot">PJ Codeworks</span><span>Este e um modelo. O site real fica com o mesmo nivel de acabamento.</span><span class="whats">${escapeHtml(d.phone ? `WhatsApp ${d.phone}` : 'Botao WhatsApp')}</span></div>  
  </main>  
  </body>  
  </html>`  
  }  
    
  function quebrarLinhaSvg(texto, maxChars, maxLinhas) {  
    const words = String(texto || '').split(/\s+/).filter(Boolean)  
    const linhas = []  
    let atual = ''  
    for (const w of words) {  
      const cand = atual ? `${atual} ${w}` : w  
      if (cand.length > maxChars && atual) {  
        linhas.push(atual)  
        atual = w  
      } else {  
        atual = cand  
      }  
      if (linhas.length >= maxLinhas) break  
    }  
    if (atual && linhas.length < maxLinhas) linhas.push(atual)  
    return linhas  
  }  
    
  function montarPreviewSiteSvg(d) {  
    const modeloNome = d.modelo === 'premium' ? 'Premium' : d.modelo === 'iniciante' ? 'Iniciante' : 'Padrao'  
    const bg = d.modelo === 'premium' ? '#101820' : d.modelo === 'iniciante' ? '#16312b' : '#18212f'  
    const accent = d.modelo === 'premium' ? '#35d07f' : d.modelo === 'iniciante' ? '#f0c85a' : '#38bdf8'  
    const soft = d.modelo === 'premium' ? '#e9fff3' : d.modelo === 'iniciante' ? '#fff7dc' : '#e7f7ff'  
    const h1 = quebrarLinhaSvg(`${d.negocio} com presenca profissional no Google`, 18, 4)  
    const sub = quebrarLinhaSvg('Uma pagina clara para mostrar seus servicos, passar confianca e levar o cliente direto para o WhatsApp.', 55, 3)  
    const servs = d.servicos.slice(0, 4)  
    const imgTags = d.imagens.slice(0, 3).map((img, i) => {  
      const x = i === 0 ? 604 : i === 1 ? 604 : 822  
      const y = i === 0 ? 998 : 1148  
      const w = i === 0 ? 436 : 204  
      const h = i === 0 ? 132 : 104  
      return `<image href="data:${escapeXml(img.media_type)};base64,${img.data}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip${i})"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="none" stroke="#dce3ec"/>`  
    }).join('')  
    const placeholderTags = d.imagens.length ? '' : `  
      <rect x="604" y="998" width="436" height="132" rx="18" fill="url(#photoGrad)"/><text x="822" y="1072" text-anchor="middle" font-size="24" font-weight="700" fill="#e2e8f0">Foto do trabalho</text>  
      <rect x="604" y="1148" width="204" height="104" rx="18" fill="url(#photoGrad)"/><text x="706" y="1207" text-anchor="middle" font-size="22" font-weight="700" fill="#e2e8f0">Antes</text>  
      <rect x="822" y="1148" width="218" height="104" rx="18" fill="url(#photoGrad)"/><text x="931" y="1207" text-anchor="middle" font-size="22" font-weight="700" fill="#e2e8f0">Depois</text>`  
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">  
    <defs>  
      <linearGradient id="heroGlow" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.20"/><stop offset="48%" stop-color="#ffffff" stop-opacity="0"/></linearGradient>  
      <linearGradient id="photoGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#172033"/><stop offset="100%" stop-color="#475569"/></linearGradient>  
      <clipPath id="clip0"><rect x="604" y="998" width="436" height="132" rx="18"/></clipPath>  
      <clipPath id="clip1"><rect x="604" y="1148" width="204" height="104" rx="18"/></clipPath>  
      <clipPath id="clip2"><rect x="822" y="1148" width="218" height="104" rx="18"/></clipPath>  
    </defs>  
    <rect width="1080" height="1350" fill="#ffffff"/>  
    <rect width="1080" height="760" fill="${bg}"/>  
    <rect width="1080" height="760" fill="url(#heroGlow)"/>  
    <rect x="76" y="54" width="42" height="42" rx="12" fill="${accent}"/>  
    <text x="132" y="84" font-family="Inter, Arial, Helvetica, sans-serif" font-size="23" font-weight="900" fill="#ffffff">${escapeXml(d.negocio)}</text>  
    <text x="684" y="84" font-family="Inter, Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#d7e0ec">Servicos</text>  
    <text x="796" y="84" font-family="Inter, Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#d7e0ec">Projetos</text>  
    <text x="914" y="84" font-family="Inter, Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#d7e0ec">Contato</text>  
    <rect x="782" y="150" width="228" height="66" rx="22" fill="#ffffff" fill-opacity="0.12" stroke="#ffffff" stroke-opacity="0.28"/>  
    <text x="896" y="192" text-anchor="middle" font-family="Inter, Arial, Helvetica, sans-serif" font-size="24" fill="#ffffff">Modelo ${escapeXml(modeloNome)}</text>  
    <text x="76" y="166" font-family="Inter, Arial, Helvetica, sans-serif" font-size="25" letter-spacing="3" font-weight="700" fill="${accent}">${escapeXml(d.cidade.toUpperCase())}</text>  
    ${h1.map((line, i) => `<text x="76" y="${256 + i * 76}" font-family="Inter, Arial, Helvetica, sans-serif" font-size="76" font-weight="900" fill="#ffffff">${escapeXml(line)}</text>`).join('')}  
    ${sub.map((line, i) => `<text x="76" y="${590 + i * 40}" font-family="Inter, Arial, Helvetica, sans-serif" font-size="31" fill="#d7e0ec">${escapeXml(line)}</text>`).join('')}  
    <rect x="76" y="650" width="338" height="78" rx="18" fill="${accent}"/>  
    <text x="245" y="700" text-anchor="middle" font-family="Inter, Arial, Helvetica, sans-serif" font-size="30" font-weight="900" fill="#07130f">Chamar no WhatsApp</text>  
    <rect x="0" y="760" width="1080" height="88" fill="#f8fafc"/>  
    <line x1="0" y1="848" x2="1080" y2="848" stroke="#e2e8f0"/>  
    <text x="76" y="816" font-family="Inter, Arial, Helvetica, sans-serif" font-size="27" font-weight="900" fill="#f59e0b">★★★★★</text>  
    <text x="244" y="816" font-family="Inter, Arial, Helvetica, sans-serif" font-size="27" font-weight="900" fill="#172033">31 clientes atendidos · Aparece no Google</text>  
    <rect x="76" y="892" width="492" height="394" rx="18" fill="#ffffff" stroke="#dce3ec"/>  
    <text x="104" y="960" font-family="Inter, Arial, Helvetica, sans-serif" font-size="34" font-weight="800" fill="#172033">O que entraria</text>  
    ${servs.map((s, i) => `<rect x="104" y="${996 + i * 66}" width="436" height="54" rx="14" fill="${soft}"/><text x="126" y="${1031 + i * 66}" font-family="Inter, Arial, Helvetica, sans-serif" font-size="25" font-weight="700" fill="#172033">${escapeXml(s)}</text>`).join('')}  
    <text x="104" y="1244" font-family="Inter, Arial, Helvetica, sans-serif" font-size="27" font-weight="800" fill="#172033">${escapeXml(d.total ? `Modelo ${modeloNome}: ${d.total}` : `Modelo ${modeloNome}: previa visual`)}</text>  
    ${d.entrada && d.parcela ? `<text x="104" y="1274" font-family="Inter, Arial, Helvetica, sans-serif" font-size="20" fill="#566579">${escapeXml(`${d.entrada} + 3x ${d.parcela}`)}</text>` : ''}  
    <rect x="576" y="892" width="492" height="394" rx="18" fill="#ffffff" stroke="#dce3ec"/>  
    <text x="604" y="960" font-family="Inter, Arial, Helvetica, sans-serif" font-size="34" font-weight="800" fill="#172033">Fotos e prova visual</text>  
    ${imgTags || placeholderTags}  
    <g transform="translate(58 1200) rotate(-6)">  
      <rect x="0" y="0" width="445" height="70" rx="12" fill="#f59e0b" stroke="#111827" stroke-width="4"/>  
      <text x="222" y="47" text-anchor="middle" font-family="Inter, Arial, Helvetica, sans-serif" font-size="29" font-weight="900" fill="#111827">MODELO DE DEMONSTRACAO</text>  
    </g>  
    <rect x="0" y="1272" width="1080" height="78" fill="#101820"/>  
    <text x="76" y="1322" font-family="Inter, Arial, Helvetica, sans-serif" font-size="22" font-weight="900" fill="#ffffff">PJ Codeworks</text>  
    <text x="252" y="1322" font-family="Inter, Arial, Helvetica, sans-serif" font-size="22" fill="#e5e7eb">Este e um modelo. O site real fica com o mesmo nivel de acabamento.</text>  
    <text x="1004" y="1322" text-anchor="end" font-family="Inter, Arial, Helvetica, sans-serif" font-size="22" font-weight="900" fill="#35d07f">${escapeXml(d.phone ? `WhatsApp ${d.phone}` : 'Botao WhatsApp')}</text>  
  </svg>`  
  }  
    
  function carregarPlaywrightOpcional() {  
    try {  
      return require('playwright')  
    } catch (_) {  
      return null  
    }  
  }  
    
  async function renderizarPreviewSiteImagem(html, svgFallback) {  
    const pw = carregarPlaywrightOpcional()  
    if (!pw || !pw.chromium) {  
      return {  
        b64: Buffer.from(svgFallback, 'utf8').toString('base64'),  
        mimetype: 'image/svg+xml',  
        renderer: 'svg-fallback',  
      }  
    }  
    let browser = null  
    try {  
      browser = await pw.chromium.launch({ headless: true })  
      const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 })  
      await page.setContent(html, { waitUntil: 'networkidle' })  
      const buf = await page.screenshot({ type: 'png', fullPage: false })  
      return { b64: buf.toString('base64'), mimetype: 'image/png', renderer: 'playwright' }  
    } finally {  
      if (browser) await browser.close().catch(() => {})  
    }  
  }  
    
  /**
   * Gera imagem via mesma rota OpenAI usada na prévia de site (gpt-image-2).
   * @param {string} prompt
   * @param {{ size?: string, quality?: string, rendererSuffix?: string }} [options]
   */
  async function gerarImagemOpenAiPorPrompt(prompt, options = {}) {
    if (!OPENAI_KEY) throw new Error('OPENAI_KEY nao configurada')
    const size = options.size || '1024x1536'
    const quality = options.quality || 'medium'
    const suf = options.rendererSuffix || 'custom'
    const { data } = await axios.post(
      'https://api.openai.com/v1/images/generations',
      {
        model: 'gpt-image-2',
        prompt,
        n: 1,
        size,
        quality,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 90000,
      }
    )
    const b64 = data?.data?.[0]?.b64_json
    if (!b64) throw new Error('gpt-image-2 nao retornou imagem')
    return { b64, mimetype: 'image/png', renderer: `gpt-image-2-${suf}` }
  }

  async function gerarWireframeComGPT(dados, estilo = 'lapis') {
    const prompt = montarPromptWireframe(dados, estilo)
    return gerarImagemOpenAiPorPrompt(prompt, { size: '1024x1536', quality: 'medium', rendererSuffix: estilo })
  }

  async function gerarPreviewSite(numero, perfil, historico, opcoes = {}) {  
    const dados = dadosPreviewSite(numero, perfil, historico, opcoes)  
    if (OPENAI_KEY) {  
      try {  
        const estilo = escolherEstiloWireframe(dados, opcoes)  
        const imagem = await gerarWireframeComGPT(dados, estilo)  
        return { ...imagem, html: null, dados }  
      } catch (err) {  
        logger.error('gpt-image-2 falhou, usando fallback HTML:', err.message)  
      }  
    } else {  
      logger.warn('OPENAI_KEY ausente; preview de site usando fallback HTML/SVG')  
    }  
    
    const html = montarPreviewSiteHtml(dados)  
    const svg = montarPreviewSiteSvg(dados)  
    const imagem = await renderizarPreviewSiteImagem(html, svg)  
    return { ...imagem, html, dados }  
  }  
    
    
  async function gerarEEnviarPreviewSite(numero, perfil, historico, opcoes = {}) {  
    const preview = await gerarPreviewSite(numero, perfil, historico, opcoes)  
    const captionPreview = await gerarCaptionPreview(perfil, preview?.dados, numero)  
    await enviarImagemBase64(numero, preview.b64, preview.mimetype, captionPreview, 'preview-site')  
    await registrarEventoComercial(numero, 'recebeu_preview', {  
      modelo: preview.dados.modelo,  
      renderer: preview.renderer,  
      com_fotos: preview.dados.imagens.length > 0,  
    })  
    const msgPosPreview = await gerarMensagemPosPreview(perfil, preview?.dados, numero)  
    if (msgPosPreview) {  
      try {  
        await new Promise((resolve) => setTimeout(resolve, 1500))  
        await enviarMensagem(numero, msgPosPreview)  
      } catch (err) {  
        logger.error('Falha ao enviar mensagem pos-preview:', err?.message || err)  
      }  
    }  
    logger.info(`Preview de site enviado para ${String(numero).slice(0, 24)} (${preview.renderer})`)  
    return preview  
  }  
    
  function gerarMensagemPosPreviewFallback(perfil = {}) {  
    const negocio = String(perfil?.negocio || '').trim().toLowerCase()  
    if (negocio.includes('pint')) {  
      return 'Essa e a direcao da sua presenca online. O que voce achou? Ficou claro seu servico e o caminho pro cliente chamar no WhatsApp?'  
    }  
    return 'Essa e a direcao. O que voce achou? Ficou claro o que voce faz e como o cliente chama no WhatsApp?'  
  }  
    
  /**  
   * Mensagem curta enviada ao lead logo apos a previa visual de site.  
   * Gerada por Claude Sonnet com voz da PJ Codeworks; cai para frase fallback  
   * (gerarMensagemPosPreviewFallback) se a chamada falhar ou nao houver chave.  
   */  
  async function gerarMensagemPosPreview(perfil = {}, dadosPreview = {}, numero = null) {  
    const negocio = String(perfil?.negocio || '').trim()  
    const cidade = String(perfil?.cidade || '').trim()  
    const modelo = String(dadosPreview?.modelo || perfil?.plano_sugerido || 'padrao').trim()  
    const comFotos = Array.isArray(dadosPreview?.imagens) && dadosPreview.imagens.length > 0  
    const system =  
      `Voce e o assistente de vendas da PJ Codeworks. Acabou de enviar uma previa visual do site ao lead.\n` +  
      `Escreva UMA mensagem curta (1 frase, no maximo 160 caracteres) para o WhatsApp do lead pedindo o que ele achou da previa.\n` +  
      `REGRAS:\n` +  
      `- Tom natural de WhatsApp, sem ser vendedor.\n` +  
      `- Foque em: 1) o que ele achou e 2) se ficou claro o servico e o caminho pro cliente chamar no WhatsApp.\n` +  
      `- NAO use markdown, NAO use placeholders entre colchetes, NAO se reapresente, NAO mande dois assuntos.\n` +  
      `- NAO termine com emoji excessivo (no maximo 1).\n` +  
      `- Retorne APENAS a frase, sem aspas, sem JSON, sem prefixo.`  
    const user =  
      `Contexto do lead:\n` +  
      `- nicho: ${negocio || '(nao coletado)'}\n` +  
      `- cidade: ${cidade || '(nao coletada)'}\n` +  
      `- modelo da previa enviada: ${modelo}\n` +  
      `- a previa contem fotos reais do trabalho: ${comFotos ? 'sim' : 'nao'}\n\n` +  
      `Gere a frase de pergunta sobre a previa.`  
    const r = await chamarClaudeAuxiliar({  
      tipo: 'pos_preview',  
      numero,  
      estagio: 'proposta',  
      system,  
      userMessage: user,  
      max_tokens: 160,  
      temperature: 0.5,  
      metadata: { modelo, com_fotos: comFotos },  
    })  
    if (!r.ok || !r.texto) return gerarMensagemPosPreviewFallback(perfil)  
    const limpo = r.texto.replace(/^["'`\s]+|["'`\s]+$/g, '').trim()  
    if (!limpo || limpo.length > 320) return gerarMensagemPosPreviewFallback(perfil)  
    return limpo  
  }  
    
  // ─── MÍDIA WHATSAPP (Evolution + Claude / Whisper) ─────────────────────────────

  return {
    PREVIEW_SITE_MODELOS,
    caseDeReferenciaPorNicho,
    montarPreviewSiteCaption,
    gerarCaptionPreview,
    escapeHtml,
    escapeXml,
    textoCurto,
    moedaPtBr,
    modeloPreviewSite,
    extrairServicosDoHistorico,
    dadosPreviewSite,
    montarPromptWireframe,
    escolherEstiloWireframe,
    montarPreviewSiteHtml,
    quebrarLinhaSvg,
    montarPreviewSiteSvg,
    carregarPlaywrightOpcional,
    renderizarPreviewSiteImagem,
    gerarImagemOpenAiPorPrompt,
    gerarWireframeComGPT,
    gerarPreviewSite,
    gerarEEnviarPreviewSite,
    gerarMensagemPosPreviewFallback,
    gerarMensagemPosPreview,
  }
}

module.exports = { createPreviewSite }
