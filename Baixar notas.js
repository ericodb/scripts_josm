"use strict";

// ── Imports Java ─────────────────────────────────────────────
const JDialog        = Java.type("javax.swing.JDialog");
const JPanel         = Java.type("javax.swing.JPanel");
const JButton        = Java.type("javax.swing.JButton");
const UIManager      = Java.type("javax.swing.UIManager");
const JScrollPane    = Java.type("javax.swing.JScrollPane");
const JLabel         = Java.type("javax.swing.JLabel");
const BoxLayout      = Java.type("javax.swing.BoxLayout");
const JSlider        = Java.type("javax.swing.JSlider");
const JRadioButton         = Java.type("javax.swing.JRadioButton");
const ButtonGroup          = Java.type("javax.swing.ButtonGroup");
const JSpinner             = Java.type("javax.swing.JSpinner");
const SpinnerNumberModel   = Java.type("javax.swing.SpinnerNumberModel");
const JOptionPane    = Java.type("javax.swing.JOptionPane");
const JTextField     = Java.type("javax.swing.JTextField");
const JTextArea      = Java.type("javax.swing.JTextArea");
const JSplitPane     = Java.type("javax.swing.JSplitPane");
const JComboBox      = Java.type("javax.swing.JComboBox");
const Timer          = Java.type("javax.swing.Timer");
const BorderFactory  = Java.type("javax.swing.BorderFactory");

const BorderLayout = Java.type("java.awt.BorderLayout");
const Dimension    = Java.type("java.awt.Dimension");
const FlowLayout   = Java.type("java.awt.FlowLayout");
const Color        = Java.type("java.awt.Color");
const Point        = Java.type("java.awt.Point");

const JavaURL           = Java.type("java.net.URL");
const URLEncoder        = Java.type("java.net.URLEncoder");
const HttpURLConnection = Java.type("java.net.HttpURLConnection");

const ByteArrayInputStream  = Java.type("java.io.ByteArrayInputStream");
const ByteArrayOutputStream = Java.type("java.io.ByteArrayOutputStream");
const AtomicReference       = Java.type("java.util.concurrent.atomic.AtomicReference");
const FutureTask            = Java.type("java.util.concurrent.FutureTask");
const Executors             = Java.type("java.util.concurrent.Executors");
const ArrayList             = Java.type("java.util.ArrayList");

const Normalizer     = Java.type("java.text.Normalizer");
const NormalizerForm = Java.type("java.text.Normalizer$Form");

const NoteReader      = Java.type("org.openstreetmap.josm.io.NoteReader");
const NoteLayer       = Java.type("org.openstreetmap.josm.gui.layer.NoteLayer");
const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification    = Java.type("org.openstreetmap.josm.gui.Notification");

const Coordinate     = Java.type("org.openstreetmap.gui.jmapviewer.Coordinate");
const MapPolygonImpl = Java.type("org.openstreetmap.gui.jmapviewer.MapPolygonImpl");
const JMapViewer     = Java.type("org.openstreetmap.gui.jmapviewer.JMapViewer");

const Proxy             = Java.type("java.lang.reflect.Proxy");
const InvocationHandler = Java.type("java.lang.reflect.InvocationHandler");
const RunnableClass     = Java.type("java.lang.Runnable").class;

function makeDownloadTask(urlStr) {
    const JavaString = Java.type("java.lang.String");
    const jUrl = new JavaString(urlStr);

    // AtomicReference armazena o resultado (byte[], null, ou "ERR:mensagem")
    const result = new AtomicReference(null);
    const handler = Proxy.newProxyInstance(
        Java.type("java.lang.Thread").currentThread().getContextClassLoader(),
        [InvocationHandler.class],
        {
            invoke: function(proxy, method, args) {
                return null;
            }
        }
    );

    const HttpClient  = Java.type("java.net.http.HttpClient");
    const HttpRequest = Java.type("java.net.http.HttpRequest");
    const HttpResponse = Java.type("java.net.http.HttpResponse");
    const BodyHandlers = Java.type("java.net.http.HttpResponse$BodyHandlers");
    const URI         = Java.type("java.net.URI");
    const Duration    = Java.type("java.time.Duration");

    // Cria cliente e requisição
    const client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(15))
        .build();

    const request = HttpRequest.newBuilder()
        .uri(URI.create(jUrl))
        .timeout(Duration.ofSeconds(30))
        .header("User-Agent", "JOSM-Plugin-Notas/1.0")
        .GET()
        .build();

    // sendAsync retorna CompletableFuture<HttpResponse<byte[]>>
    const future = client.sendAsync(request, BodyHandlers.ofByteArray());

    return future;
}

// Processa o resultado de um CompletableFuture<HttpResponse<byte[]>> concluído
function processarFuture(future) {
    const response = future.get();
    const status   = response.statusCode();
    if (status === 404 || status === 410) return null;
    if (status >= 400) throw new Error("HTTP " + status);
    return parsearBytes(response.body());
}

function parsearBytes(bytes) {
    if (bytes === null) return null;
    const stream = new ByteArrayInputStream(bytes);
    try   { return new NoteReader(stream).parse(); }
    finally { try { stream.close(); } catch (e) {} }
}

// ── Normalização ──────────────────────────────────────────────

function removeAcentos(txt) {
    return Normalizer.normalize(txt, NormalizerForm.NFD)
                     .replace(/[\u0300-\u036f]/g, "");
}

// ── Utilitários ───────────────────────────────────────────────

function validarId(v) {
    if (!v || v.trim() === "") {
        new Notification("ID obrigatório.")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        return null;
    }
    const n = parseInt(v, 10);
    if (isNaN(n)) {
        new Notification("ID inválido.")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        return null;
    }
    return n;
}

function adicionarCamadaNotas(notas, nome) {
    if (!nome) nome = "Notas";
    const camada = new NoteLayer(notas, nome);
    const lm     = MainApplication.getLayerManager();
    const layers = lm.getLayers().toArray();
    for (let i = 0; i < layers.length; i++) {
        if (layers[i] instanceof NoteLayer &&
                layers[i].getName() === camada.getName())
            lm.removeLayer(layers[i]);
    }
    lm.addLayer(camada);
}

// ── Nominatim ────────────────────────────────────────────────
// Retorna CompletableFuture<HttpResponse<byte[]>> para uma busca Nominatim.
// O resultado é JSON com campo "boundingbox": [minlat, maxlat, minlon, maxlon]

function urlNominatim(lugar, featuretype) {
    let url = "https://nominatim.openstreetmap.org/search?q=" +
              URLEncoder.encode(lugar, "UTF-8") +
              "&format=json&limit=5&accept-language=pt&polygon_geojson=1";
    if (featuretype) url += "&featuretype=" + featuretype;
    return url;
}

// Parseia um item do resultado do Nominatim em { label, bbox, aneis }
function parsearItemNominatim(item) {
    const bb = item.boundingbox;
    if (!bb) return null;
    const minLat = parseFloat(bb[0]), maxLat = parseFloat(bb[1]);
    const minLon = parseFloat(bb[2]), maxLon = parseFloat(bb[3]);
    if (isNaN(minLat) || isNaN(maxLat) || isNaN(minLon) || isNaN(maxLon)) return null;

    const bbox = (maxLon - minLon > 180)
        ? [-180, minLat, 180, maxLat]
        : [minLon, minLat, maxLon, maxLat];

    let aneis = null;
    const geo = item.geojson;
    if (geo) {
        try {
            if (geo.type === "Polygon") {
                aneis = geo.coordinates;
            } else if (geo.type === "MultiPolygon") {
                aneis = [];
                for (let p = 0; p < geo.coordinates.length; p++)
                    for (let r = 0; r < geo.coordinates[p].length; r++)
                        aneis.push(geo.coordinates[p][r]);
            }
        } catch (e) { aneis = null; }
    }

    const tipo        = item.type        || "";
    const classe      = item.class       || "";
    const addresstype = item.addresstype || ""; // "state","city","country","town" etc.
    const adminLevel  = item.admin_level ? Number(item.admin_level) : null;
    const osmType     = item.osm_type    || "";
    const osmId       = osmType + String(item.osm_id || ""); // chave única: osm_type+osm_id

    // Filtra resultados irrelevantes — bairros, vilas e áreas menores que cidades
    const tiposRejeitados = new Set(["suburb","village","hamlet","quarter","neighbourhood",
                                     "residential","industrial","farm","island","islet"]);
    if (tiposRejeitados.has(tipo) || tiposRejeitados.has(addresstype)) return null;

    // Determina o rótulo de tipo em ordem de confiabilidade:
    const addressLegiveis = {
        "state": "estado", "country": "país", "city": "cidade",
        "town": "município", "county": "município", "district": "distrito",
        "region": "região", "province": "província"
    };
    // admin_level no Brasil: 2=país, 4=estado, 8=município
    const adminLegiveis = { 2: "país", 4: "estado", 5: "região", 6: "mesorregião",
                            7: "microrregião", 8: "município" };

    let tipoLabel = addressLegiveis[addresstype]
                 || (adminLevel !== null ? adminLegiveis[adminLevel] : null)
                 || addressLegiveis[tipo]
                 || "";

    const partes   = (item.display_name || "").split(",");
    const nomeBase = partes[0].trim();
    const contexto = partes.slice(1, 3).join(",").trim();
    const label    = nomeBase + (tipoLabel ? " (" + tipoLabel + ")" : "")
                     + (contexto ? " — " + contexto : "");
    return { label: label, tipo: tipo, osmId: osmId, bbox: bbox, aneis: aneis };
}

// Parseia a lista de resultados do Nominatim.
// Retorna array de { label, tipo, bbox, aneis } ou null se vazio.
function parsearNominatim(bytes) {
    if (!bytes) return null;
    try {
        const txt  = String(new (Java.type("java.lang.String"))(bytes, "UTF-8"));
        const lista = JSON.parse(txt);
        if (!Array.isArray(lista) || lista.length === 0) return null;
        const resultados = [];
        for (let i = 0; i < lista.length; i++) {
            const r = parsearItemNominatim(lista[i]);
            if (r) resultados.push(r);
        }
        return resultados.length > 0 ? resultados : null;
    } catch (e) { return null; }
}

// Ray-casting: ponto [lon, lat] dentro do anel [[lon,lat],...]?
// Rejeição rápida por bbox do anel antes do algoritmo completo.
function pontoNoAnel(lon, lat, anel) {
    // Bbox rápido do anel — elimina a maioria sem ray-casting
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let k = 0; k < anel.length; k++) {
        if (anel[k][0] < minX) minX = anel[k][0];
        if (anel[k][0] > maxX) maxX = anel[k][0];
        if (anel[k][1] < minY) minY = anel[k][1];
        if (anel[k][1] > maxY) maxY = anel[k][1];
    }
    if (lon < minX || lon > maxX || lat < minY || lat > maxY) return false;

    // Ray-casting completo só para anéis cujo bbox contém o ponto
    let dentro = false;
    for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
        const xi = anel[i][0], yi = anel[i][1];
        const xj = anel[j][0], yj = anel[j][1];
        if (((yi > lat) !== (yj > lat)) &&
            (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi))
            dentro = !dentro;
    }
    return dentro;
}

// Verifica se o centro do bloco [minLon,minLat,maxLon,maxLat] cai
// dentro de pelo menos um dos anéis do polígono.
function blocoNoPoli(bl, aneis) {
    if (!aneis) return true; // sem polígono → aceita tudo
    const cx = (bl[0] + bl[2]) / 2;
    const cy = (bl[1] + bl[3]) / 2;
    for (let a = 0; a < aneis.length; a++)
        if (pontoNoAnel(cx, cy, aneis[a])) return true;
    return false;
}

// ── Helpers de URL ────────────────────────────────────────────

function gerarBlocos(minLon, minLat, maxLon, maxLat) {
    const blocos = [];
    const MAX_LON_WIDTH = 2.5;     // mais estreito para EUA/Russia
    const DIV_LAT = 10;            // mais divisões em latitude

    const cruzaAntimeridiano = (maxLon - minLon > 180 || minLon > maxLon);

    if (cruzaAntimeridiano) {
        // Oeste
        let lon = -180;
        while (lon < 0) {
            const lonEnd = Math.min(0, lon + MAX_LON_WIDTH);
            gerarFaixa(lon, lonEnd, minLat, maxLat, DIV_LAT, blocos);
            lon = lonEnd;
        }
        // Leste
        lon = 0;
        while (lon < 180) {
            const lonEnd = Math.min(180, lon + MAX_LON_WIDTH);
            gerarFaixa(lon, lonEnd, minLat, maxLat, DIV_LAT, blocos);
            lon = lonEnd;
        }
    } else {
        let lon = minLon;
        while (lon < maxLon) {
            const lonEnd = Math.min(maxLon, lon + MAX_LON_WIDTH);
            gerarFaixa(lon, lonEnd, minLat, maxLat, DIV_LAT, blocos);
            lon = lonEnd;
        }
    }
    return blocos;
}

function gerarFaixa(lonMin, lonMax, latMin, latMax, divLat, blocos) {
    const height = latMax - latMin;
    const stepLat = height / divLat;

    for (let j = 0; j < divLat; j++) {
        const latStart = latMin + j * stepLat;
        const latEnd   = Math.min(latMax, latStart + stepLat);
        blocos.push([lonMin, latStart, lonMax, latEnd]);
    }
}

function montarUrlBbox(minLon, minLat, maxLon, maxLat, onlyOpen, diasFechadas) {
    minLon = Math.max(-180, Math.min(180, minLon));
    maxLon = Math.max(-180, Math.min(180, maxLon));
    if (minLon > maxLon) [minLon, maxLon] = [maxLon, minLon];
    // closed=0: só abertas | closed=-1: todas sem limite | closed=N: fechadas há até N dias
    const closed = onlyOpen ? 0 : (diasFechadas !== undefined ? diasFechadas : -1);
    return "https://api.openstreetmap.org/api/0.6/notes" +
           "?bbox=" + minLon.toFixed(6) + "," + minLat.toFixed(6) + "," +
                      maxLon.toFixed(6) + "," + maxLat.toFixed(6) +
           "&limit=250&closed=" + closed;
}


function urlBuscaGlobalPalavra(palavra) {
    return "https://api.openstreetmap.org/api/0.6/notes/search?q=" +
           URLEncoder.encode(palavra, "UTF-8") + "&limit=1000";
}

function urlNotaPorId(noteId) {
    return "https://api.openstreetmap.org/api/0.6/notes/" + noteId;
}

function urlBuscaUsuario(usuario, onlyOpen, diasFechadas) {
    const closed = onlyOpen ? 0 : (diasFechadas !== undefined ? diasFechadas : -1);
    let url = "https://api.openstreetmap.org/api/0.6/notes/search?display_name=" +
              URLEncoder.encode(usuario, "UTF-8") + "&limit=10000";
    url += "&closed=" + closed;
    return url;
}

// ── Classe principal ──────────────────────────────────────────

function NotasFinder() {
    this._setupUi();
    this._setupListeners();
}

NotasFinder.prototype._setupUi = function () {
    // ── Campo de busca Nominatim ──────────────────────────────
    this.fieldLugar  = new JTextField(25);
    this.fieldLugar.setToolTipText("Ex: São Paulo, Minas Gerais, Brasil...");
    this.btnBuscarLugar = new JButton("Buscar");

    const painelLugar = new JPanel(new FlowLayout(FlowLayout.LEFT, 4, 2));
    painelLugar.add(new JLabel("Local:"));
    painelLugar.add(this.fieldLugar);
    painelLugar.add(this.btnBuscarLugar);

    // Rótulo que mostra o bbox encontrado
    this.labelBbox = new JLabel("Nenhuma área selecionada, (pode ser refinado com Estado,Cidade)");
    this.labelBbox.setForeground(new Color(125, 125, 125));
    const painelBbox = new JPanel(new FlowLayout(FlowLayout.LEFT, 4, 0));
    painelBbox.add(this.labelBbox);

    // ── Filtros ───────────────────────────────────────────────
    const GridBagLayout      = Java.type("java.awt.GridBagLayout");
    const GridBagConstraints = Java.type("java.awt.GridBagConstraints");
    const Insets             = Java.type("java.awt.Insets");

    this.comboTipo  = new JComboBox(["Palavra-chave", "Usuário", "ID"]);
    this.fieldValor = new JTextField(16);

    // Dica contextual HTML — atualizada pelo listener do combo
    this.labelDica = new JLabel("");
    this.labelDica.setVerticalAlignment(Java.type("javax.swing.SwingConstants").TOP);

    // ── Mapa ──────────────────────────────────────────────────
    this.miniMapa = new JMapViewer();
    this.miniMapa.setPreferredSize(new Dimension(460, 240));
    this.miniMapa.setZoom(1);

    // ── Radios ────────────────────────────────────────────────
    this.radioAbertas         = new JRadioButton("Apenas abertas", true);
    this.radioAbertasFechadas = new JRadioButton("Abertas e fechadas", false);
    const grp = new ButtonGroup();
    grp.add(this.radioAbertas);
    grp.add(this.radioAbertasFechadas);

    // Spinner de dias para notas fechadas: -1=todas, 0=só abertas, N=fechadas há até N dias
    this.spinnerDias = new JSpinner(new SpinnerNumberModel(-1, -1, 30, 1));
    this.spinnerDias.setPreferredSize(new Dimension(58, 22));
    this.spinnerDias.setToolTipText("<html>Dias desde fechamento:<br>"
        + "<b>-1</b> = todas as notas fechadas<br>"
        + "<b>0</b> = apenas abertas<br>"
        + "<b>N</b> = fechadas há até Max. 30 dias</html>");
    this.spinnerDias.setEnabled(false); // desabilitado quando "Apenas abertas" está ativo

    // Habilita/desabilita spinner conforme o radio selecionado
    const self_r = this;
    this.radioAbertas.addActionListener(function() {
        self_r.spinnerDias.setEnabled(false);
    });
    this.radioAbertasFechadas.addActionListener(function() {
        self_r.spinnerDias.setEnabled(true);
    });

    // Painel unificado: filtros + radios na col 0, dica na col 1 com gridheight=2
    const painelFiltros = new JPanel(new GridBagLayout());
    const gbc = new GridBagConstraints();
    gbc.insets = new Insets(1, 2, 1, 2);
    gbc.anchor = GridBagConstraints.NORTHWEST;

    // Linha 0, col 0: filtro + valor
    const painelEsqFiltros = new JPanel();
    painelEsqFiltros.setLayout(new BoxLayout(painelEsqFiltros, BoxLayout.Y_AXIS));
    const painelFiltro = new JPanel(new FlowLayout(FlowLayout.LEFT, 4, 1));
    painelFiltro.add(new JLabel("Filtro:"));
    painelFiltro.add(this.comboTipo);
    const painelValor = new JPanel(new FlowLayout(FlowLayout.LEFT, 4, 1));
    painelValor.add(new JLabel("Valor: "));
    painelValor.add(this.fieldValor);
    painelEsqFiltros.add(painelFiltro);
    painelEsqFiltros.add(painelValor);
    gbc.gridx = 0; gbc.gridy = 0; gbc.weightx = 0; gbc.fill = GridBagConstraints.NONE;
    painelFiltros.add(painelEsqFiltros, gbc);

    // Linha 1, col 0: radios + spinner de dias
    const painelRadios = new JPanel();
    painelRadios.setLayout(new BoxLayout(painelRadios, BoxLayout.Y_AXIS));
    const painelAbertas = new JPanel(new FlowLayout(FlowLayout.LEFT, 2, 0));
    painelAbertas.add(this.radioAbertas);
    painelRadios.add(painelAbertas);
    const painelFechadas = new JPanel(new FlowLayout(FlowLayout.LEFT, 2, 0));
    painelFechadas.add(this.radioAbertasFechadas);
    painelFechadas.add(new JLabel("Dias:"));
    painelFechadas.add(this.spinnerDias);
    painelRadios.add(painelFechadas);
    gbc.gridx = 0; gbc.gridy = 1; gbc.weightx = 0; gbc.fill = GridBagConstraints.NONE;
    painelFiltros.add(painelRadios, gbc);

    // Col 1, linhas 0+1: dica HTML ocupa toda a altura (filtros + radios)
    gbc.gridx = 1; gbc.gridy = 0; gbc.gridheight = 2;
    gbc.weightx = 1; gbc.weighty = 1;
    gbc.fill = GridBagConstraints.BOTH;
    painelFiltros.add(this.labelDica, gbc);

    // ── Painel de Progresso Embedded ─────────────────────────
    this.labelStatus = new JLabel("Aguardando busca...");

    this.sliderProgresso = new JSlider(0, 100, 0);
    this.sliderProgresso.setPreferredSize(new Dimension(450, 30));
    this.sliderProgresso.setEnabled(false);

    this.btnCancelarBusca = new JButton("Cancelar Busca", UIManager.getIcon("OptionPane.cancelIcon"));
    this.btnCancelarBusca.setEnabled(false);

    const painelProgHeader = new JPanel(new BorderLayout(5, 0));
    painelProgHeader.add(this.labelStatus, BorderLayout.CENTER);
    painelProgHeader.add(this.btnCancelarBusca, BorderLayout.EAST);

    this.painelProgresso = new JPanel();
    this.painelProgresso.setLayout(new BoxLayout(this.painelProgresso, BoxLayout.Y_AXIS));
    this.painelProgresso.setBorder(BorderFactory.createTitledBorder("Progresso da Busca"));
    this.painelProgresso.add(painelProgHeader);
    this.painelProgresso.add(this.sliderProgresso);

    // ── Painel principal ──────────────────────────────────────
    this.panel = new JPanel();
    this.panel.setLayout(new BoxLayout(this.panel, BoxLayout.Y_AXIS));
    this.panel.setBorder(BorderFactory.createEmptyBorder(6, 8, 6, 8));
    this.panel.add(painelLugar);
    this.panel.add(painelBbox);
    this.panel.add(this.miniMapa);
    this.panel.add(painelFiltros);
    this.panel.add(this.painelProgresso);

    // bbox e polígono encontrados pelo Nominatim — null = nenhum
    this._bbox  = null;
    this._aneis = null;
};

NotasFinder.prototype._atualizarDica = function (tipo) {
    if (tipo === "Usuário") {
        this.labelDica.setText(
            "<html><div style='color:#b36200;font-size:10px;padding:2px 4px;'>" +
            "<b>Usuário</b>: busca global<br>" +
            "ou restrita a um local.<br>" +
            "Busca parcial de nome.</div></html>");
    } else if (tipo === "ID") {
        this.labelDica.setText(
            "<html><div style='color:#b36200;font-size:10px;padding:2px 4px;'>" +
            "<b>ID</b> faz busca global direta.<br>" +
            "O campo Local será ignorado.<br>" +
            "Digite o número da nota<br>" +
            "no campo Valor.</div></html>");
    } else {
        this.labelDica.setText(
            "<html><div style='color:#b36200;font-size:10px;padding:2px 4px;'>" +
            "Sem local: busca global<br>" +
            "em todas as notas do OSM.<br>" +
            "Com local: busca apenas<br>" +
            "na área selecionada.</div></html>");
    }
};

NotasFinder.prototype._setupListeners = function () {
    const self = this;

    // Botão Buscar: consulta Nominatim e atualiza bbox + mapa
    this.btnBuscarLugar.addActionListener(function (_e) {
        self._buscarNominatim();
    });

    // Enter no campo de lugar também dispara a busca
    this.fieldLugar.addActionListener(function (_e) {
        self._buscarNominatim();
    });

    // Listener do combo: atualiza dica, radios e valida combinações
    this.comboTipo.addActionListener(function (_e) {
        const tipo = String(self.comboTipo.getSelectedItem());
        self.radioAbertas.setEnabled(tipo !== "ID");
        self.radioAbertasFechadas.setEnabled(tipo !== "ID");
        self._atualizarDica(tipo);
    });
    // Inicializa dica com o valor padrão do combo
    self._atualizarDica(String(self.comboTipo.getSelectedItem()));
};

// Consulta Nominatim de forma assíncrona e atualiza bbox + mapa.
NotasFinder.prototype._buscarNominatim = function () {
    const self  = this;
    const lugar = String(this.fieldLugar.getText()).trim();
    if (!lugar) {
        new Notification("Digite um local para buscar.")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        return;
    }

    // Sempre busca com state, country e sem filtro em paralelo
    const featuretypes = ["state", "country", null];

    this.btnBuscarLugar.setEnabled(false);
    this.labelBbox.setText("Buscando: " + lugar + "...");

    const HttpClient   = Java.type("java.net.http.HttpClient");
    const HttpRequest  = Java.type("java.net.http.HttpRequest");
    const BodyHandlers = Java.type("java.net.http.HttpResponse$BodyHandlers");
    const URI          = Java.type("java.net.URI");
    const Duration     = Java.type("java.time.Duration");

    const client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10)).build();

    // Dispara uma requisição por featuretype em paralelo
    const futures = featuretypes.map(function(ft) {
        const jUrl = new (Java.type("java.lang.String"))(urlNominatim(lugar, ft));
        const req  = HttpRequest.newBuilder()
            .uri(URI.create(jUrl))
            .timeout(Duration.ofSeconds(15))
            .header("User-Agent", "JOSM-Plugin-Notas/1.0")
            .header("Accept-Language", "pt")
            .GET().build();
        return client.sendAsync(req, BodyHandlers.ofByteArray());
    });

    // Timer aguarda todos os futures sem bloquear a EDT
    const timerNom = new Timer(50, null);
    timerNom.setRepeats(true);
    timerNom.addActionListener(function (_e) {
        if (futures.some(function(f) { return !f.isDone(); })) return;
        timerNom.stop();
        self.btnBuscarLugar.setEnabled(true);
        try {
            // Mescla resultados deduplcando por osm_id — evita cidade=estado com mesmo nome
            const todos = [];
            const idsVistos = {};
            futures.forEach(function(f) {
                try {
                    const resp = f.get();
                    if (resp.statusCode() >= 400) return;
                    const lista = parsearNominatim(resp.body());
                    if (!lista) return;
                    lista.forEach(function(r) {
                        const chave = r.osmId || r.label;
                        if (!idsVistos[chave]) {
                            idsVistos[chave] = true;
                            todos.push(r);
                        }
                    });
                } catch(e) {}
            });

            if (todos.length === 0) {
                self.labelBbox.setText("Local não encontrado: " + lugar);
                self._bbox  = null;
                self._aneis = null;
                return;
            }

            // Um único resultado: aplica direto; vários: mostra lista navegável por teclado
            let escolhido;
            if (todos.length === 1) {
                escolhido = todos[0];
            } else {
                const JList        = Java.type("javax.swing.JList");
                const JScrollPane  = Java.type("javax.swing.JScrollPane");
                const DefaultListModel = Java.type("javax.swing.DefaultListModel");
                const ListSelectionModel = Java.type("javax.swing.ListSelectionModel");

                const model = new DefaultListModel();
                todos.forEach(function(r) { model.addElement(r.label); });

                const lista = new JList(model);
                lista.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
                lista.setSelectedIndex(0);
                lista.setVisibleRowCount(Math.min(todos.length, 8));

                const scroll = new JScrollPane(lista);
                scroll.setPreferredSize(new Dimension(420, lista.getPreferredScrollableViewportSize().height));

                const dlgSel = new JDialog(MainApplication.getMainFrame(), "Selecione o local", true);
                dlgSel.setLayout(new BorderLayout());
                const lblSel = new JLabel("  Selecione o local:");
                lblSel.setBorder(BorderFactory.createEmptyBorder(6, 4, 4, 4));
                dlgSel.add(lblSel, BorderLayout.NORTH);
                dlgSel.add(scroll, BorderLayout.CENTER);

                const btnOkSel  = new JButton("OK",       UIManager.getIcon("OptionPane.yesIcon"));
                const btnCanSel = new JButton("Cancelar", UIManager.getIcon("OptionPane.noIcon"));
                const pBtnSel   = new JPanel(new FlowLayout(FlowLayout.CENTER, 8, 6));
                pBtnSel.add(btnOkSel); pBtnSel.add(btnCanSel);
                dlgSel.add(pBtnSel, BorderLayout.SOUTH);

                const selIdx = [- 1]; // -1 = cancelado

                btnOkSel.addActionListener(function() {
                    selIdx[0] = lista.getSelectedIndex();
                    dlgSel.dispose();
                });
                btnCanSel.addActionListener(function() { dlgSel.dispose(); });

                // Enter na lista confirma seleção
                lista.addKeyListener(Java.extend(Java.type("java.awt.event.KeyAdapter"), {
                    keyPressed: function(e) {
                        if (e.getKeyCode() === 10) { // VK_ENTER
                            selIdx[0] = lista.getSelectedIndex();
                            dlgSel.dispose();
                        }
                    }
                }));

                dlgSel.pack();
                dlgSel.setLocationRelativeTo(MainApplication.getMainFrame());
                dlgSel.setVisible(true); // modal — bloqueia até fechar

                if (selIdx[0] < 0) {
                    self.labelBbox.setText("Seleção cancelada.");
                    return;
                }
                escolhido = todos[selIdx[0]];
            }

            self._bbox  = escolhido.bbox;
            self._aneis = escolhido.aneis;
            const [minLon, minLat, maxLon, maxLat] = escolhido.bbox;
            const temPoli = escolhido.aneis ? " (polígono)" : " (bbox)";
            self.labelBbox.setText(
                "Bbox: " + minLat.toFixed(3) + " → " + maxLat.toFixed(3) +
                "  /  " + minLon.toFixed(3) + " → " + maxLon.toFixed(3) + temPoli);
            self._atualizarMapa(escolhido.bbox, escolhido.aneis);
        } catch (ex) {
            self.labelBbox.setText("Erro ao buscar: " + ex);
            self._bbox = null;
        }
    });
    timerNom.start();
};

// bbox = [minLon, minLat, maxLon, maxLat]
// aneis = lista de anéis do polígono real (opcional)
NotasFinder.prototype._atualizarMapa = function (bbox, aneis) {
    try { this.miniMapa.setMapPolygonList(new ArrayList()); } catch (e1) {
        try { this.miniMapa.setMapMarkerList(new ArrayList()); } catch (e2) {}
    }
    if (!bbox) return;
    const [minx, miny, maxx, maxy] = bbox;

    const delta = Math.max(Math.abs(maxy - miny), Math.abs(maxx - minx));
    this.miniMapa.setZoom(delta < 0.5 ? 12 : delta < 1 ? 10 : delta < 5 ? 8
                        : delta < 10 ? 7 : delta < 20 ? 6 : delta > 100 ? 2 : 5);

    try {
        if (aneis && aneis.length > 0) {
            // Desenha o contorno real do polígono — um MapPolygonImpl por anel
            aneis.forEach(function(anel) {
                const vList = new ArrayList();
                for (let i = 0; i < anel.length; i++) {
                    vList.add(new Coordinate(anel[i][1], anel[i][0])); // lat, lon
                }
                // Fecha o anel se necessário
                if (anel.length > 0) {
                    vList.add(new Coordinate(anel[0][1], anel[0][0]));
                }
                const poly = new MapPolygonImpl(vList);
                poly.setColor(Color.RED);
                poly.setBackColor(new Color(255, 0, 0, 60));
                this.miniMapa.addMapPolygon(poly);
            }.bind(this));
        } else {
            // Sem polígono real: desenha o retângulo do bbox
            const vList = new ArrayList();
            vList.add(new Coordinate(maxy, minx)); vList.add(new Coordinate(maxy, maxx));
            vList.add(new Coordinate(miny, maxx)); vList.add(new Coordinate(miny, minx));
            vList.add(new Coordinate(maxy, minx));
            const poly = new MapPolygonImpl(vList);
            poly.setColor(Color.RED);
            poly.setBackColor(new Color(255, 0, 0, 100));
            this.miniMapa.addMapPolygon(poly);
        }
        this.miniMapa.setDisplayToFitMapElements(false, false, true);
    } catch (ex) {
        const cp = this.miniMapa.getMapPosition((miny + maxy) / 2, (minx + maxx) / 2);
        this.miniMapa.setCenter(cp || new Point(210, 160));
    }
};
// ── Fluxo principal ───────────────────────────────────────────

NotasFinder.prototype.run = function () {
    const self = this;
    const dlg = new JDialog(MainApplication.getMainFrame(), "Baixar Notas", false);
    dlg.setDefaultCloseOperation(2);

    const btnOk  = new JButton("Buscar Notas", UIManager.getIcon("OptionPane.okIcon"));
    const btnCan = new JButton("Fechar",        UIManager.getIcon("OptionPane.noIcon"));
    this.btnOk = btnOk;

    const painelBotoes = new JPanel(new FlowLayout(FlowLayout.CENTER, 10, 6));
    painelBotoes.add(btnOk);
    painelBotoes.add(btnCan);

    const painelTotal = new JPanel();
    painelTotal.setLayout(new BoxLayout(painelTotal, BoxLayout.Y_AXIS));
    painelTotal.add(this.panel);
    painelTotal.add(painelBotoes);

    dlg.setContentPane(painelTotal);
    dlg.pack();
    dlg.setLocationRelativeTo(MainApplication.getMainFrame());

    btnOk.addActionListener(function (_e) { self._iniciarBusca(); });
    btnCan.addActionListener(function (_e) { dlg.dispose(); });

    dlg.setVisible(true);
};

NotasFinder.prototype._iniciarBusca = function () {
    const tipoFiltro = String(this.comboTipo.getSelectedItem());
    const valorRaw   = String(this.fieldValor.getText()).trim();
    const onlyOpen   = this.radioAbertas.isSelected();
    const diasFechadas = onlyOpen ? 0 : Number(this.spinnerDias.getValue());
    const valorNorm  = (tipoFiltro !== "ID" && valorRaw) ?
                       removeAcentos(valorRaw.toLowerCase()) : "";
    const idVal      = (tipoFiltro === "ID") ? validarId(valorRaw) : null;

    // Busca por ID — não precisa de bbox
    if (tipoFiltro === "ID") {
        if (idVal !== null)
            this._buscaComTimer([urlNotaPorId(idVal)], null, null, null, "Nota " + idVal);
        return;
    }

    // Busca por usuário usa /notes/search?display_name= com limit=10000
    // bbox é opcional: sem bbox busca globalmente, com bbox restringe à área
    if (tipoFiltro === "Usuário") {
        if (!valorRaw) {
            new Notification("Informe o nome do usuário.")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
            return;
        }
        const bboxUsuario  = this._bbox  || null;
        const aneisUsuario = this._aneis || null;
        const onlyOpen2    = this.radioAbertas.isSelected();
        const diasFechadas2 = onlyOpen2 ? 0 : Number(this.spinnerDias.getValue());
        this._buscaUsuarioPaginado(valorRaw, bboxUsuario, aneisUsuario, onlyOpen2, diasFechadas2);
        return;
    }

    // Busca por Palavra-chave sem bbox = busca global na API de search
    if (tipoFiltro === "Palavra-chave" && !this._bbox) {
        if (!valorRaw) {
            new Notification("Informe a Palavra-chave ou busque um local primeiro.")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
            return;
        }
        this._buscaComTimer([urlBuscaGlobalPalavra(valorRaw)], null, "Palavra-chave", valorNorm, "Busca global");
        return;
    }

    // Busca regional — requer bbox do Nominatim
    if (!this._bbox) {
        new Notification("Busque um local no campo 'Local' antes de iniciar.")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        return;
    }

    if (!valorRaw && tipoFiltro !== "Palavra-chave") {
        new Notification("Informe o valor para o filtro (" + tipoFiltro + ").")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        return;
    }

    const [minLon, minLat, maxLon, maxLat] = this._bbox;
    const aneis = this._aneis;

    // Gera blocos sobre o bbox e filtra pelos que caem dentro do polígono real.
    const todosBlocos = gerarBlocos(minLon, minLat, maxLon, maxLat);
    const blocos = todosBlocos.filter(function(bl) { return blocoNoPoli(bl, aneis); });

    if (blocos.length === 0) {
        new Notification("Nenhum bloco dentro da área. Tente buscar por região menor.")
            .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
        return;
    }

    this._buscaComTimer(
        blocos.map(function(bl) { return montarUrlBbox(bl[0], bl[1], bl[2], bl[3], onlyOpen, diasFechadas); }),
        blocos,
        tipoFiltro, valorNorm, null);
};

// ── Motor central: Timer + HttpClient.sendAsync ───────────────

NotasFinder.prototype._buscaUsuarioPaginado = function(usuario, bbox, aneis, onlyOpen, diasFechadas) {
    const url = urlBuscaUsuario(usuario, onlyOpen, diasFechadas);
    const valorNorm = removeAcentos(String(usuario).toLowerCase());
    this._buscaComTimer([url], null, "Usuário", valorNorm, "Usuário: " + usuario, bbox, aneis);
};

const NUM_WORKERS = 4; // máximo de downloads simultâneos

NotasFinder.prototype._buscaComTimer = function (urls, blocos, tipoFiltro, valorNorm, label, bboxFiltro, aneisFiltro) {
    const self    = this;
    const total   = urls.length;
    let cancelado = false;

    // Configura UI do painel de progresso embedded
    this.sliderProgresso.setMinimum(0);
    this.sliderProgresso.setMaximum(total);
    this.sliderProgresso.setValue(0);
    this.sliderProgresso.setEnabled(true);
    this.labelStatus.setText("Preparando " + total + " requisições...");
    this.btnCancelarBusca.setEnabled(true);
    if (this.btnOk) this.btnOk.setEnabled(false);

    // Listener para o botão de cancelamento
    const listenerCancel = function (_e) {
        cancelado = true;
    };

    // Remove listeners anteriores
    const listeners = this.btnCancelarBusca.getActionListeners();
    for (let l = 0; l < listeners.length; l++) {
        this.btnCancelarBusca.removeActionListener(listeners[l]);
    }
    this.btnCancelarBusca.addActionListener(listenerCancel);

    function finalizarBuscaUI() {
        self.sliderProgresso.setEnabled(false);
        self.btnCancelarBusca.setEnabled(false);
        if (self.btnOk) self.btnOk.setEnabled(true);
    }

    const HttpClient   = Java.type("java.net.http.HttpClient");
    const HttpRequest  = Java.type("java.net.http.HttpRequest");
    const BodyHandlers = Java.type("java.net.http.HttpResponse$BodyHandlers");
    const URI          = Java.type("java.net.URI");
    const Duration     = Java.type("java.time.Duration");

    const client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(15))
        .executor(Executors.newFixedThreadPool(NUM_WORKERS))
        .build();

    let futures    = new Array(total).fill(null);
    let disparados = false;

    const notas_filtradas = new ArrayList();
    const ids_vistos      = {};
    let   concluidos      = 0;

    // Timer verifica a cada 50ms quais futures terminaram
    const timer = new Timer(50, null);
    timer.setRepeats(true);

    timer.addActionListener(function (_e) {
        if (!disparados) {
            disparados = true;
            self.labelStatus.setText("Disparando " + total + " requisições...");
            for (let i = 0; i < urls.length; i++) {
                const jUrl    = new (Java.type("java.lang.String"))(urls[i]);
                const request = HttpRequest.newBuilder()
                    .uri(URI.create(jUrl))
                    .timeout(Duration.ofSeconds(30))
                    .header("User-Agent", "JOSM-Plugin-Notas/1.0")
                    .GET().build();
                futures[i] = client.sendAsync(request, BodyHandlers.ofByteArray());
            }
            return;
        }

        if (cancelado) {
            timer.stop();
            futures.forEach(function(f) { try { if (f) f.cancel(true); } catch(e) {} });
            self.labelStatus.setText("Busca cancelada.");
            finalizarBuscaUI();
            new Notification("Busca cancelada pelo usuário.")
                .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
            return;
        }

        // Percorre todos os futures ainda não processados
        let algumPendente = false;
        for (let i = 0; i < futures.length; i++) {
            const f = futures[i];
            if (f === null) continue;

            if (!f.isDone()) {
                algumPendente = true;
                continue;
            }

            // Future concluído
            futures[i] = null;
            concluidos++;
            self.sliderProgresso.setValue(concluidos);

            try {
                const response = f.get();
                const status   = response.statusCode();
                if (status === 404 || status === 410) continue;
                if (status >= 400) throw new Error("HTTP " + status);

                const notes = parsearBytes(response.body());
                if (!notes) continue;

                const arr = notes.toArray();
                for (let j = 0; j < arr.length; j++) {
                    const note = arr[j];
                    const nid  = String(note.getId());
                    if (ids_vistos[nid]) continue;

                    // Sem filtro (busca global/ID): aceita todas
                    if (!tipoFiltro) {
                        ids_vistos[nid] = true;
                        notas_filtradas.add(note);
                        continue;
                    }

                    let adiciona = false;
                    const comments = note.getComments().toArray();
                    for (let c = 0; c < comments.length; c++) {
                        if (tipoFiltro === "Palavra-chave") {
                            const txt = removeAcentos(
                                String(comments[c].getText() || "").toLowerCase());
                            if (txt.indexOf(valorNorm) !== -1) { adiciona = true; break; }
                        } else if (tipoFiltro === "Usuário") {
                            const uobj  = comments[c].getUser();
                            const uname = uobj ?
                                removeAcentos(String(uobj.getName()).toLowerCase()) : "";
                            // Busca parcial — "tarta" encontra "tartaruga"
                            if (valorNorm && uname.indexOf(
                                    removeAcentos(String(valorNorm).toLowerCase())) !== -1) {
                                adiciona = true; break;
                            }
                        }
                    }
                    // Filtro geográfico local para busca por usuário com área definida.
                    if (adiciona && bboxFiltro) {
                        const lat = note.getLatLon().lat();
                        const lon = note.getLatLon().lon();
                        // Rejeição rápida pelo bbox antes do ray-casting
                        if (lon < bboxFiltro[0] || lon > bboxFiltro[2] ||
                            lat < bboxFiltro[1] || lat > bboxFiltro[3]) {
                            adiciona = false;
                        } else if (aneisFiltro && aneisFiltro.length > 0) {
                            // Polígono real disponível — verifica se está dentro de algum anel
                            let dentroDoPoli = false;
                            for (let a = 0; a < aneisFiltro.length; a++) {
                                if (pontoNoAnel(lon, lat, aneisFiltro[a])) {
                                    dentroDoPoli = true;
                                    break;
                                }
                            }
                            if (!dentroDoPoli) adiciona = false;
                        }
                    }
                    if (adiciona) { ids_vistos[nid] = true; notas_filtradas.add(note); }
                }
            } catch (ex) {
                // Erro em um bloco não interrompe os demais
            }
        }

        // Atualiza status
        const pendentes = total - concluidos;
        self.labelStatus.setText(concluidos + " de " + total + " concluídos" +
            (pendentes > 0 ? " (" + pendentes + " em andamento)..." : ""));

        // Todos concluídos
        if (!algumPendente && concluidos === total) {
            timer.stop();
            finalizarBuscaUI();
            if (notas_filtradas.size() > 0) {
                adicionarCamadaNotas(notas_filtradas, "Notas");
                new Notification(notas_filtradas.size() + " nota(s) encontrada(s).")
                    .setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
            } else {
                new Notification("Nenhuma nota encontrada com os filtros informados.")
                    .setIcon(UIManager.getIcon("OptionPane.warningIcon")).show();
            }
        }
    });

    timer.start();
};

// ── Ponto de entrada ──────────────────────────────────────────
new NotasFinder().run();
