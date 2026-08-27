/* Generateur .xlsx minimal, sans dependance : ZIP « stored » + XML SpreadsheetML.
   Utilise par la page du planning familial pour reconstruire le classeur Excel. */

/* ------------------------------------------------------------------ CRC32 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const utf8 = (s) => new TextEncoder().encode(s);

/* --------------------------------------------------------------- ZIP store */
function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

  for (const { name, data } of files) {
    const nameBytes = utf8(name);
    const crc = crc32(data);
    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0),
    ];
    chunks.push(new Uint8Array(local), nameBytes, data);

    central.push([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset),
    ]);
    central.push(nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }

  const centralChunks = [];
  let centralSize = 0;
  for (const part of central) {
    const bytes = part instanceof Uint8Array ? part : new Uint8Array(part);
    centralChunks.push(bytes);
    centralSize += bytes.length;
  }
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ]);

  const all = [...chunks, ...centralChunks, end];
  const total = all.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

/* ----------------------------------------------------------------- helpers */
const esc = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const colLetter = (i) => String.fromCharCode(64 + i);

/* Styles : index dans styles.xml, dans l'ordre de creation ci-dessous. */
const S = {
  TITRE: 1, SOUSTITRE: 2, ENTETE: 3, MOIS: 4,
  WE: 5, WE_VAC: 6, WE_LONG: 7, WE_LONG_VAC: 8,
  DATE: 9, DATE_VAC: 10, DATE_FERIE: 11, GRIS: 12,
  SAISIE: 13, SAISIE_VAC: 14,
  GAEL: 15, INGRID: 16, THOMAS: 17, FAMILLE: 18, MIXTE: 19,
  GAEL_V: 20, INGRID_V: 21, THOMAS_V: 22, FAMILLE_V: 23, MIXTE_V: 24,
  SANCTU: 25, SANCTU_DATE: 26,
};

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="14">
<font><sz val="10"/><name val="Arial"/></font>
<font><sz val="15"/><b/><color rgb="FF1F3864"/><name val="Arial"/></font>
<font><sz val="9"/><i/><color rgb="FF595959"/><name val="Arial"/></font>
<font><sz val="10"/><b/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
<font><sz val="11"/><b/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
<font><sz val="10"/><b/><color rgb="FF7F7F7F"/><name val="Arial"/></font>
<font><sz val="10"/><b/><color rgb="FFD08A2E"/><name val="Arial"/></font>
<font><sz val="8"/><b/><color rgb="FF404040"/><name val="Arial"/></font>
<font><sz val="8"/><b/><color rgb="FF4A4585"/><name val="Arial"/></font>
<font><sz val="8"/><b/><color rgb="FF7F6000"/><name val="Arial"/></font>
<font><sz val="9"/><b/><color rgb="FF3F7CB0"/><name val="Arial"/></font>
<font><sz val="9"/><b/><color rgb="FFC25E8A"/><name val="Arial"/></font>
<font><sz val="9"/><b/><color rgb="FF4E9E6E"/><name val="Arial"/></font>
<font><sz val="9"/><b/><color rgb="FFD08A2E"/><name val="Arial"/></font>
</fonts>
<fills count="10">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F3864"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEDF0F5"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD5D0EC"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF4F6F9"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDCD8F0"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEFEDF9"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="27">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="6" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="6" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="7" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="8" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="9" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="9" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="10" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="11" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="12" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="13" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="10" fillId="9" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="11" fillId="9" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="12" fillId="9" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="13" fillId="9" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="9" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="6" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="9" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
</cellXfs>
</styleSheet>`;

const STYLE_PERSONNE = { gael: S.GAEL, ingrid: S.INGRID, thomas: S.THOMAS, famille: S.FAMILLE };
const STYLE_PERSONNE_V = { gael: S.GAEL_V, ingrid: S.INGRID_V, thomas: S.THOMAS_V, famille: S.FAMILLE_V };
const INITIALE = { gael: "G", ingrid: "I", thomas: "T", famille: "F" };

/* ------------------------------------------------------------- construction */
function construireLignes(cal, etat) {
  const lignes = [];
  const merges = [];
  const hauteurs = {};
  let r = 0;

  const pousser = (cells, h) => { lignes.push(cells); r++; if (h) hauteurs[r] = h; return r; };

  pousser([{ c: 1, v: "Planning des activités familiales — année scolaire 2026-2027", s: S.TITRE }], 26);
  merges.push("A1:F1");
  pousser([{
    c: 1, s: S.SOUSTITRE,
    v: "Export du planning en ligne · colonnes jeudi / vendredi / lundi ouvertes uniquement si le jour "
      + "est férié · fond lavande = vacances scolaires · G / I / T / F = Gaël, Ingrid, Thomas, Famille",
  }], 15);
  merges.push("A2:F2");
  pousser([], 6);

  const entetes = ["WE", "Jeudi (si férié)", "Vendredi (si férié)", "Samedi", "Dimanche", "Lundi (si férié)"];
  pousser(entetes.map((v, i) => ({ c: i + 1, v, s: S.ENTETE })), 28);

  let moisCourant = null;
  for (const we of cal.weekends) {
    if (we.moisCle !== moisCourant) {
      moisCourant = we.moisCle;
      const rr = pousser([{ c: 1, v: we.mois.toUpperCase(), s: S.MOIS }], 20);
      merges.push(`A${rr}:F${rr}`);
    }

    const sanctu = (etat.sanctuarises || []).includes(we.sam);
    const vac = !!we.vac;
    const ligneDate = [];
    const ligneSaisie = [];

    let styleWE = vac ? (we.long ? S.WE_LONG_VAC : S.WE_VAC) : (we.long ? S.WE_LONG : S.WE);
    if (sanctu) styleWE = S.SANCTU;
    ligneDate.push({ c: 1, v: sanctu ? `${we.n} ★` : we.n, s: styleWE, num: !sanctu });
    ligneSaisie.push({ c: 1, v: "", s: styleWE });

    we.jours.forEach((j, idx) => {
      const col = idx + 2;
      if (!j.ouvert) {
        ligneDate.push({ c: col, v: "", s: S.GRIS });
        ligneSaisie.push({ c: col, v: "", s: S.GRIS });
        return;
      }
      const libelle = j.ferie ? `${j.label} · ${j.ferie}` : j.label;
      let sDate = j.ferie ? S.DATE_FERIE : (vac ? S.DATE_VAC : S.DATE);
      if (sanctu && !j.ferie) sDate = S.SANCTU_DATE;
      ligneDate.push({ c: col, v: libelle, s: sDate });

      const actes = (etat.activites || {})[j.iso] || [];
      const textes = actes.map((a) => {
        const suffixe = a.statut === "a_confirmer" ? " (à confirmer)" : "";
        return `${INITIALE[a.qui] || "?"} — ${a.texte}${suffixe}`;
      });
      const qui = new Set(actes.map((a) => a.qui));
      let sSaisie;
      if (actes.length === 0) sSaisie = vac ? S.SAISIE_VAC : S.SAISIE;
      else if (qui.size === 1) {
        const seul = [...qui][0];
        sSaisie = vac ? (STYLE_PERSONNE_V[seul] || S.MIXTE_V) : (STYLE_PERSONNE[seul] || S.MIXTE);
      } else sSaisie = vac ? S.MIXTE_V : S.MIXTE;

      ligneSaisie.push({ c: col, v: textes.join("\n"), s: sSaisie });
    });

    const rDate = pousser(ligneDate, 24);
    const nbLignesMax = Math.max(
      1,
      ...we.jours.map((j) => {
        const actes = (etat.activites || {})[j.iso] || [];
        return actes.reduce((n, a) => n + Math.max(1, Math.ceil((a.texte.length + 6) / 38)), 0);
      })
    );
    const rSaisie = pousser(ligneSaisie, Math.max(52, 13 * nbLignesMax + 10));
    merges.push(`A${rDate}:A${rSaisie}`);
    we.jours.forEach((j, idx) => {
      if (!j.ouvert) merges.push(`${colLetter(idx + 2)}${rDate}:${colLetter(idx + 2)}${rSaisie}`);
    });
  }

  return { lignes, merges, hauteurs };
}

function feuilleXml({ lignes, merges, hauteurs }) {
  const rows = lignes.map((cells, i) => {
    const n = i + 1;
    const h = hauteurs[n] ? ` ht="${hauteurs[n]}" customHeight="1"` : "";
    const cs = cells.map((c) => {
      const ref = `${colLetter(c.c)}${n}`;
      if (c.v === "" || c.v === null || c.v === undefined) return `<c r="${ref}" s="${c.s || 0}"/>`;
      if (c.num && typeof c.v === "number") return `<c r="${ref}" s="${c.s || 0}"><v>${c.v}</v></c>`;
      return `<c r="${ref}" s="${c.s || 0}" t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`;
    }).join("");
    return `<row r="${n}"${h}>${cs}</row>`;
  }).join("");

  const largeurs = [5, 23, 23, 40, 40, 23]
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView showGridLines="0" tabSelected="1" workbookViewId="0">
<pane xSplit="1" ySplit="4" topLeftCell="B5" activePane="bottomRight" state="frozen"/>
</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${largeurs}</cols>
<sheetData>${rows}</sheetData>
<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

function genererXlsx(cal, etat) {
  const feuille = feuilleXml(construireLignes(cal, etat));

  const fichiers = [
    {
      name: "[Content_Types].xml",
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
    },
    {
      name: "_rels/.rels",
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    },
    {
      name: "xl/workbook.xml",
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Planning" sheetId="1" r:id="rId1"/></sheets>
</workbook>`),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    },
    { name: "xl/styles.xml", data: utf8(STYLES_XML) },
    { name: "xl/worksheets/sheet1.xml", data: utf8(feuille) },
  ];

  return zip(fichiers);
}
