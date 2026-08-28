"use strict";

// IMPORTS
const MainApplication = Java.type("org.openstreetmap.josm.gui.MainApplication");
const Notification    = Java.type("org.openstreetmap.josm.gui.Notification");
const UIManager       = Java.type("javax.swing.UIManager");
const SwingUtilities  = Java.type("javax.swing.SwingUtilities");

const JDialog         = Java.type("javax.swing.JDialog");
const JPanel          = Java.type("javax.swing.JPanel");
const JLabel          = Java.type("javax.swing.JLabel");
const JTextField      = Java.type("javax.swing.JTextField");
const JButton         = Java.type("javax.swing.JButton");
const JComboBox       = Java.type("javax.swing.JComboBox");
const JSpinner        = Java.type("javax.swing.JSpinner");
const SpinnerNumberModel = Java.type("javax.swing.SpinnerNumberModel");
const BoxLayout       = Java.type("javax.swing.BoxLayout");
const GridLayout      = Java.type("java.awt.GridLayout");
const BorderFactory   = Java.type("javax.swing.BorderFactory");
const FlowLayout      = Java.type("java.awt.FlowLayout");
const Box             = Java.type("javax.swing.Box");
const Timer           = Java.type("javax.swing.Timer");

const GpxReader          = Java.type("org.openstreetmap.josm.io.GpxReader");
const GpxLayer           = Java.type("org.openstreetmap.josm.gui.layer.GpxLayer");
const OsmReader          = Java.type("org.openstreetmap.josm.io.OsmReader");
const OsmDataLayer       = Java.type("org.openstreetmap.josm.gui.layer.OsmDataLayer");
const ByteArrayInputStream = Java.type("java.io.ByteArrayInputStream");
const GZIPInputStream    = Java.type("java.util.zip.GZIPInputStream");
const URLEncoder         = Java.type("java.net.URLEncoder");

const HttpClient      = Java.type("java.net.http.HttpClient");
const HttpRequest     = Java.type("java.net.http.HttpRequest");
const BodyHandlers    = Java.type("java.net.http.HttpResponse$BodyHandlers");
const URI             = Java.type("java.net.URI");
const Duration        = Java.type("java.time.Duration");

const WindowAdapter   = Java.type("java.awt.event.WindowAdapter");
const ActionListener  = Java.extend(Java.type("java.awt.event.ActionListener"));
const DocumentListener = Java.extend(Java.type("javax.swing.event.DocumentListener"));

// UTILITÁRIOS
function jStr(s) { return new (Java.type("java.lang.String"))(String(s)); }

function novoClient() {
    return HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(15))
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build();
}

function aoTerminar(future, callback) {
    const t = new Timer(100, null);
    t.setRepeats(true);
    t.addActionListener(new ActionListener({ actionPerformed: function() {
        if (!future.isDone()) return;
        t.stop();
        try { callback(future.get()); } catch(e) { callback(null, e); }
    }}));
    t.start();
}

// LÓGICA DE DOWNLOAD
function baixarGPX(gpxId, resetUI) {
    const url = "https://www.openstreetmap.org/traces/" + gpxId + "/data";
    const request = HttpRequest.newBuilder().uri(URI.create(jStr(url))).header("User-Agent", "JOSM-Script/1.0").GET().build();
    aoTerminar(novoClient().sendAsync(request, BodyHandlers.ofByteArray()), function(resp, err) {
        resetUI();
        if (err || !resp || resp.statusCode() >= 400) {
            new Notification("Erro ao baixar GPX " + gpxId).setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
            return;
        }
        try {
            const bytes = resp.body();
            const isGzip = (bytes.length > 2 && (bytes[0] & 0xFF) === 0x1f && (bytes[1] & 0xFF) === 0x8b);
            const is = isGzip ? new GZIPInputStream(new ByteArrayInputStream(bytes)) : new ByteArrayInputStream(bytes);
            const reader = new GpxReader(is); 
            reader.parse(false);
            if (reader.getGpxData()) {
                MainApplication.getLayerManager().addLayer(new GpxLayer(reader.getGpxData(), "Trilha: " + gpxId));
                new Notification("Trilha GPX carregada.").setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
            }
            is.close();
        } catch(e) { new Notification("Erro ao processar GPX.").setIcon(UIManager.getIcon("OptionPane.errorIcon")).show(); }
    });
}

function baixarChangeset(id, resetUI) {
    const osmUrl = "https://www.openstreetmap.org/api/0.6/changeset/" + id + "/download";
    const rcUrl  = "http://127.0.0.1:8111/import?url=" + String(URLEncoder.encode(osmUrl, "UTF-8")).replace(/\+/g, "%20");
    const request = HttpRequest.newBuilder().uri(URI.create(jStr(rcUrl))).GET().build();
    aoTerminar(HttpClient.newHttpClient().sendAsync(request, BodyHandlers.ofString()), function(resp, err) {
        resetUI();
        if (err || (resp && resp.statusCode() !== 200)) {
            new Notification("Remote Control indisponível.").setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
        } else {
            new Notification("Changeset " + id + " carregado.").setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
        }
    });
}

function baixarHistorico(objType, osmId, version, resetUI) {
    const metaUrl = "https://www.openstreetmap.org/api/0.6/" + objType + "/" + osmId + "/" + version;
    const request = HttpRequest.newBuilder().uri(URI.create(jStr(metaUrl))).header("User-Agent", "JOSM-Script/1.0").GET().build();
    
    aoTerminar(novoClient().sendAsync(request, BodyHandlers.ofString()), function(resp, err) {
        if (err || !resp || resp.statusCode() >= 400) { 
            resetUI(); 
            new Notification("Objeto ou versão não encontrada.").setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
            return; 
        }
        const tsMatch = String(resp.body()).match(/timestamp="([^"]+)"/);
        if (!tsMatch) { resetUI(); return; }
        
        const query = '[out:xml][timeout:60][date:"' + tsMatch[1] + '"];(' + objType + '(' + osmId + '); >>; ); out meta;';
        const body = "data=" + String(URLEncoder.encode(jStr(query), "UTF-8"));
        const post = HttpRequest.newBuilder().uri(URI.create("https://overpass-api.de/api/interpreter"))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString(jStr(body))).build();
        
        aoTerminar(novoClient().sendAsync(post, BodyHandlers.ofByteArray()), function(resp2, err2) {
            resetUI();
            if (err2 || !resp2 || resp2.statusCode() >= 400) {
                new Notification("Erro na consulta ao Overpass.").setIcon(UIManager.getIcon("OptionPane.errorIcon")).show();
            } else {
                try {
                    const is = new ByteArrayInputStream(resp2.body());
                    const ds = OsmReader.parseDataSet(is, null);
                    const camada = new OsmDataLayer(ds, "Histórico: " + objType + " " + osmId + " (v" + version + ")", null);
                    MainApplication.getLayerManager().addLayer(camada);
                    new Notification("Histórico carregado com sucesso.").setIcon(UIManager.getIcon("OptionPane.informationIcon")).show();
                } catch(e) { 
                    new Notification("Erro ao carregar dados no JOSM.").setIcon(UIManager.getIcon("OptionPane.errorIcon")).show(); 
                }
            }
        });
    });
}

// INTERFACE
SwingUtilities.invokeLater(function() {
    const dialog = new JDialog(MainApplication.getMainFrame(), "Ferramentas de Download", false);
    const outer  = new JPanel(); outer.setLayout(new BoxLayout(outer, BoxLayout.Y_AXIS));
    outer.setBorder(BorderFactory.createEmptyBorder(10, 12, 10, 12));

    const btnGpx = new JButton("Baixar GPX", UIManager.getIcon("OptionPane.okIcon"));
    const btnCs  = new JButton("Baixar Changeset", UIManager.getIcon("OptionPane.okIcon"));
    const btnHist = new JButton("Baixar Histórico", UIManager.getIcon("OptionPane.okIcon"));
    
    const fldGpx = new JTextField(20);
    const fldCs  = new JTextField(20);
    const fldId  = new JTextField(10);
    
    const cmbType = new JComboBox(["relation", "way", "node"]);
    const spnVer  = new JSpinner(new SpinnerNumberModel(1, 1, 99, 1));

    // Auto-preenchimento por seleção
    try {
        const el = MainApplication.getLayerManager().getEditLayer();
        if (el && el.data) {
            const sel = el.data.getSelectedRelations().toArray();
            if (sel.length > 0) fldId.setText(String(sel[0].getId()));
        }
    } catch(e) {}

    function resetUI() {
        [btnGpx, btnCs, btnHist].forEach(b => b.setEnabled(true));
        [fldGpx, fldCs, fldId, cmbType, spnVer].forEach(c => c.setEnabled(true));
    }

    function lockOthers(keep) {
        if (keep !== 'gpx') btnGpx.setEnabled(false);
        if (keep !== 'cs') btnCs.setEnabled(false);
        if (keep !== 'hist') btnHist.setEnabled(false);
    }

    const docListener = (type) => new DocumentListener({
        insertUpdate: function() { lockOthers(type); },
        removeUpdate: function() { if(!fldGpx.getText() && !fldCs.getText() && !fldId.getText()) resetUI(); },
        changedUpdate: function() {}
    });

    fldGpx.getDocument().addDocumentListener(docListener('gpx'));
    fldCs.getDocument().addDocumentListener(docListener('cs'));
    fldId.getDocument().addDocumentListener(docListener('hist'));

    const criarLblHtml = (txt) => {
        let l = new JLabel("<html><center><font color='gray' size='2'>" + txt + "</font></center></html>");
        l.setAlignmentX(0.5); return l;
    };

    // GPX
    const secGpx = new JPanel(); secGpx.setLayout(new BoxLayout(secGpx, BoxLayout.Y_AXIS));
    secGpx.setBorder(BorderFactory.createTitledBorder("Trilha GPX"));
    fldGpx.setAlignmentX(0.5); secGpx.add(fldGpx);
    secGpx.add(criarLblHtml("ID ou link osm.org/traces/ID"));
    btnGpx.addActionListener(new ActionListener({ actionPerformed: function() { 
        const m = fldGpx.getText().match(/(\d+)/); 
        if(m) { [fldGpx, fldCs, fldId].forEach(f => f.setEnabled(false)); baixarGPX(m[1], resetUI); }
    }}));
    const p1 = new JPanel(); p1.add(btnGpx); secGpx.add(p1);

    // Changeset
    const secCs = new JPanel(); secCs.setLayout(new BoxLayout(secCs, BoxLayout.Y_AXIS));
    secCs.setBorder(BorderFactory.createTitledBorder("Changeset"));
    fldCs.setAlignmentX(0.5); secCs.add(fldCs);
    secCs.add(criarLblHtml("ID ou link osm.org/changeset/ID"));
    btnCs.addActionListener(new ActionListener({ actionPerformed: function() { 
        const m = fldCs.getText().match(/(\d+)/); 
        if(m) { [fldGpx, fldCs, fldId].forEach(f => f.setEnabled(false)); baixarChangeset(m[1], resetUI); }
    }}));
    const p2 = new JPanel(); p2.add(btnCs); secCs.add(p2);

    // Histórico
    const secHist = new JPanel(); secHist.setLayout(new BoxLayout(secHist, BoxLayout.Y_AXIS));
    secHist.setBorder(BorderFactory.createTitledBorder("Histórico"));
    const g = new JPanel(new GridLayout(3, 2, 5, 5));
    g.add(new JLabel("Tipo:")); g.add(cmbType); g.add(new JLabel("ID:")); g.add(fldId); g.add(new JLabel("Versão:")); g.add(spnVer);
    secHist.add(g);
    btnHist.addActionListener(new ActionListener({ actionPerformed: function() { 
        if(fldId.getText()) { [fldGpx, fldCs, fldId].forEach(f => f.setEnabled(false)); baixarHistorico(cmbType.getSelectedItem(), fldId.getText(), spnVer.getValue(), resetUI); }
    }}));
    const p3 = new JPanel(); p3.add(btnHist); secHist.add(p3);

    let isCleanedUp = false;
    const cleanup = function() {
        if (isCleanedUp) return;
        isCleanedUp = true;

        if (dialog) {
            try {
                const listeners = dialog.getWindowListeners();
                for (let i = 0; i < listeners.length; i++) {
                    dialog.removeWindowListener(listeners[i]);
                }
            } catch(e) {}
            try { dialog.dispose(); } catch(e) {}
        }
    };

    if (typeof __josmContextResetHooks__ !== 'undefined') {
        __josmContextResetHooks__.register(cleanup);
    }
    if (typeof josmContextResetHooks !== 'undefined') {
        josmContextResetHooks.register(cleanup);
    }

    if (globalThis.__scriptCleanup__) {
        try { globalThis.__scriptCleanup__(); } catch(e) {}
    }
    if (globalThis.scriptCleanup) {
        try { globalThis.scriptCleanup(); } catch(e) {}
    }
    globalThis.__scriptCleanup__ = cleanup;
    globalThis.scriptCleanup = cleanup;

    dialog.addWindowListener(new (Java.extend(WindowAdapter, {
        windowClosing: function() { cleanup(); }
    }))());

    const btnFechar = new JButton("Fechar", UIManager.getIcon("OptionPane.noIcon"));
    btnFechar.addActionListener(new ActionListener({ actionPerformed: () => cleanup() }));
    const pF = new JPanel(); pF.add(btnFechar);

    outer.add(secGpx); outer.add(Box.createVerticalStrut(5));
    outer.add(secCs); outer.add(Box.createVerticalStrut(5));
    outer.add(secHist); outer.add(Box.createVerticalStrut(5));
    outer.add(pF);
    
    dialog.add(outer); dialog.pack(); dialog.setLocationRelativeTo(MainApplication.getMainFrame());
    dialog.setVisible(true);
});
