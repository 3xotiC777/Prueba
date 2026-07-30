import os
import re
import io
import zipfile
from pathlib import Path
from flask import Flask, render_template, request, jsonify, send_file, redirect, url_for
import pandas as pd
import numpy as np

app = Flask(__name__)
app.config['SECRET_KEY'] = 'ruteador-secret-key-2026'

BASE_DIR = Path(__file__).parent.resolve()
UPLOADS_DIR = BASE_DIR / 'uploads'
OUTPUT_DIR = BASE_DIR / 'generated_csvs'

UPLOADS_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# Preset default Excel file path
DEFAULT_EXCEL_PATH = BASE_DIR / 'excel.xlsx'
if not DEFAULT_EXCEL_PATH.exists():
    # Fallback to Downloads if copied
    DEFAULT_EXCEL_PATH = Path(r'c:\Users\loque\Downloads\Ruteador\excel.xlsx')

# Active state storage
CURRENT_STATE = {
    'country': 'República Dominicana',
    'excel_path': str(DEFAULT_EXCEL_PATH),
    'dia_campo': 1,
    'extra_point_ids': [],  # list of ID/indices added as customer requests
    'active_routes': {},   # map auditor_slug -> list of points
    'generated_files': [], # list of relative file names
    'last_updated': None
}

# Country Excel map
COUNTRY_EXCELS = {
    'República Dominicana': str(DEFAULT_EXCEL_PATH),
}

def slugify(text):
    if not text:
        return 'general'
    text = str(text).strip().lower()
    text = re.sub(r'[áàäâ]', 'a', text)
    text = re.sub(r'[éèëê]', 'e', text)
    text = re.sub(r'[íìïî]', 'i', text)
    text = re.sub(r'[óòöô]', 'o', text)
    text = re.sub(r'[úùüû]', 'u', text)
    text = re.sub(r'[ñ]', 'n', text)
    text = re.sub(r'[^a-z0-9]+', '_', text)
    return text.strip('_')

def load_dataset(excel_path):
    if not os.path.exists(excel_path):
        return None, None
    df_univ = pd.read_excel(excel_path, sheet_name='UNIVERSO')
    df_desc = pd.read_excel(excel_path, sheet_name='DESCARGA')
    return df_univ, df_desc

def get_columns(df):
    cols = list(df.columns)
    return {
        'fijo': cols[0],         # CLIENTE FIJO 30%
        'tipo': cols[1],         # TIPO CLIENTE ICE (D&N)
        'subcanal': cols[2],     # SUB CANAL
        'codigo_dn': cols[6],    # Codigo DN
        'id_pdv': cols[7],       # ID cliente/PDV
        'name_pdv': cols[8],     # NAME Cliente (PDV)
        'direccion': cols[9],    # DIRECCIÓN
        'provincia': cols[11],   # PROVINCIA
        'sector': cols[13],      # SECTOR
        'latitud': cols[20],     # LATITUD
        'longitud': cols[21],    # LONGITUD
        'seleccion': cols[34],   # SELECCION
        'estado': cols[45],      # export.Estado
        'dia': cols[46],         # DIA
        'auditor': cols[47],     # Tabla11.auditor
        'muestra_cumpl': cols[48]# MUESTRA CUMPL.
    }

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/auditor/<auditor_slug>')
def auditor_view(auditor_slug):
    return render_template('auditor.html', auditor_slug=auditor_slug)

@app.route('/api/config', methods=['GET'])
def get_config():
    excel_path = CURRENT_STATE['excel_path']
    df_univ, _ = load_dataset(excel_path)
    auditors = []
    countries = list(COUNTRY_EXCELS.keys())
    
    if df_univ is not None:
        c_meta = get_columns(df_univ)
        aud_list = df_univ[c_meta['auditor']].dropna().unique().tolist()
        auditors = [{'name': str(a), 'slug': slugify(a)} for a in sorted(aud_list)]

    return jsonify({
        'active_country': CURRENT_STATE['country'],
        'countries': countries,
        'dia_campo': CURRENT_STATE['dia_campo'],
        'auditors': auditors,
        'extra_points_count': len(CURRENT_STATE['extra_point_ids']),
        'last_updated': CURRENT_STATE['last_updated']
    })

@app.route('/api/points', methods=['GET'])
def get_points():
    excel_path = CURRENT_STATE['excel_path']
    df_univ, _ = load_dataset(excel_path)
    if df_univ is None:
        return jsonify({'error': 'Excel file not found'}), 404
        
    c = get_columns(df_univ)
    points = []
    
    # Fill NA for key columns
    df_univ[c['estado']] = df_univ[c['estado']].fillna('')
    df_univ[c['muestra_cumpl']] = df_univ[c['muestra_cumpl']].fillna('')
    
    for idx, row in df_univ.iterrows():
        lat = row[c['latitud']]
        lng = row[c['longitud']]
        
        # Valid lat/lng convert
        try:
            lat_f = float(lat)
            lng_f = float(lng)
            if np.isnan(lat_f) or np.isnan(lng_f):
                continue
        except (ValueError, TypeError):
            continue

        dia_val = row[c['dia']]
        try:
            dia_int = int(dia_val) if pd.notna(dia_val) else 999
        except (ValueError, TypeError):
            dia_int = 999

        auditor_name = str(row[c['auditor']]) if pd.notna(row[c['auditor']]) else 'Sin Asignar'

        p_info = {
            'id': int(idx),
            'pdv_id': str(row[c['id_pdv']]) if pd.notna(row[c['id_pdv']]) else str(idx),
            'name': str(row[c['name_pdv']]) if pd.notna(row[c['name_pdv']]) else 'PDV sin nombre',
            'direccion': str(row[c['direccion']]) if pd.notna(row[c['direccion']]) else '',
            'sector': str(row[c['sector']]) if pd.notna(row[c['sector']]) else '',
            'provincia': str(row[c['provincia']]) if pd.notna(row[c['provincia']]) else '',
            'lat': lat_f,
            'lng': lng_f,
            'dia': dia_int,
            'auditor': auditor_name,
            'auditor_slug': slugify(auditor_name),
            'canal': str(row[c['tipo']]) if pd.notna(row[c['tipo']]) else 'OTROS',
            'fijo': str(row[c['fijo']]).strip().upper() == 'SI',
            'seleccion': str(row[c['seleccion']]).strip().upper() if pd.notna(row[c['seleccion']]) else 'T',
            'muestra_cumpl': str(row[c['muestra_cumpl']]),
            'estado': str(row[c['estado']])
        }
        points.append(p_info)

    return jsonify({
        'total': len(points),
        'points': points
    })

@app.route('/api/select-country', methods=['POST'])
def select_country():
    data = request.json or {}
    country = data.get('country')
    if country in COUNTRY_EXCELS:
        CURRENT_STATE['country'] = country
        CURRENT_STATE['excel_path'] = COUNTRY_EXCELS[country]
        CURRENT_STATE['extra_point_ids'] = []
        return jsonify({'success': True, 'country': country})
    return jsonify({'error': 'País no registrado'}), 400

@app.route('/api/upload-excel', methods=['POST'])
def upload_excel():
    if 'file' not in request.files:
        return jsonify({'error': 'No file attached'}), 400
    file = request.files['file']
    country = request.form.get('country', 'República Dominicana')
    
    if file.filename == '':
        return jsonify({'error': 'Empty filename'}), 400
        
    save_filename = f"{slugify(country)}_excel.xlsx"
    save_path = UPLOADS_DIR / save_filename
    file.save(save_path)
    
    # Verify excel structure
    try:
        df_u, df_d = load_dataset(str(save_path))
        if df_u is None or 'UNIVERSO' not in pd.ExcelFile(str(save_path)).sheet_names:
            return jsonify({'error': 'El archivo debe contener la hoja UNIVERSO'}), 400
    except Exception as e:
        return jsonify({'error': f'Error al leer Excel: {str(e)}'}), 400

    COUNTRY_EXCELS[country] = str(save_path)
    CURRENT_STATE['country'] = country
    CURRENT_STATE['excel_path'] = str(save_path)
    CURRENT_STATE['extra_point_ids'] = []

    return jsonify({'success': True, 'message': f'Excel cargado correctamente para {country}'})

@app.route('/api/process-route', methods=['POST'])
def process_route():
    data = request.json or {}
    dia_campo = int(data.get('dia_campo', 1))
    extra_point_ids = data.get('extra_point_ids', [])
    
    CURRENT_STATE['dia_campo'] = dia_campo
    CURRENT_STATE['extra_point_ids'] = extra_point_ids
    
    excel_path = CURRENT_STATE['excel_path']
    df_univ, _ = load_dataset(excel_path)
    
    if df_univ is None:
        return jsonify({'error': 'No dataset available'}), 400
        
    c = get_columns(df_univ)
    
    # Prepare clean working copy
    df_work = df_univ.copy()
    df_work['idx_orig'] = df_work.index
    
    df_work[c['estado']] = df_work[c['estado']].fillna('')
    df_work[c['muestra_cumpl']] = df_work[c['muestra_cumpl']].fillna('')

    # Base Macro Filter:
    # 1. Col AW (MUESTRA CUMPL.) == "Cargar"
    # 2. Col AT (export.Estado) == ""
    # 3. Col AU (DIA) <= dia_campo OR idx_orig in extra_point_ids
    
    is_cargar = df_work[c['muestra_cumpl']] == 'Cargar'
    is_estado_empty = (df_work[c['estado']] == '') | (df_work[c['estado']].isna())
    is_dia_valid = df_work[c['dia']].fillna(999) <= dia_campo
    is_extra = df_work['idx_orig'].isin(extra_point_ids)
    
    filtered_mask = is_cargar & is_estado_empty & (is_dia_valid | is_extra)
    df_filtered = df_work[filtered_mask]
    
    # Clean previous generated CSVs
    for f in OUTPUT_DIR.glob('*.csv'):
        try:
            f.unlink()
        except Exception:
            pass

    generated_files = []
    auditor_routes = {}
    
    auditors = df_filtered[c['auditor']].dropna().unique()
    
    for aud in auditors:
        aud_slug = slugify(aud)
        df_aud = df_filtered[df_filtered[c['auditor']] == aud]
        
        # Save points for Auditor mobile link - SORT FIJOS FIRST!
        aud_points = []
        for _, row in df_aud.iterrows():
            lat = row[c['latitud']]
            lng = row[c['longitud']]
            try:
                lat_f = float(lat)
                lng_f = float(lng)
            except (ValueError, TypeError):
                lat_f, lng_f = 0.0, 0.0
                
            aud_points.append({
                'id': int(row['idx_orig']),
                'pdv_id': str(row[c['id_pdv']]) if pd.notna(row[c['id_pdv']]) else str(int(row['idx_orig'])),
                'name': str(row[c['name_pdv']]),
                'direccion': str(row[c['direccion']]),
                'sector': str(row[c['sector']]),
                'provincia': str(row[c['provincia']]),
                'lat': lat_f,
                'lng': lng_f,
                'dia': int(row[c['dia']]) if pd.notna(row[c['dia']]) else 999,
                'is_extra': int(row['idx_orig']) in extra_point_ids,
                'canal': str(row[c['tipo']]),
                'fijo': str(row[c['fijo']]).strip().upper() == 'SI',
                'seleccion': str(row[c['seleccion']]).strip().upper()
            })

        # Sort: FIJOS first (mandatory), then extra requested points, then regular
        aud_points.sort(key=lambda p: (not p['fijo'], not p['is_extra'], p['name']))

        auditor_routes[aud_slug] = {
            'auditor_name': str(aud),
            'slug': aud_slug,
            'total_points': len(aud_points),
            'fijos_count': sum(1 for p in aud_points if p['fijo']),
            'points': aud_points
        }

        # -------------------------------------------------------------
        # Generate 5 CSV combinations per Auditor as in VBA Macro:
        # 1. MT_T.csv -> SELECCION == 'T'
        # 2. MT_T_ON.csv -> SELECCION == 'T' & TIPO CLIENTE == 'ON PREMISE'
        # 3. MT_T_FIJOS.csv -> SELECCION == 'T' & CLIENTE FIJO 30% == 'SI'
        # 4. MT_S.csv -> SELECCION == 'S'
        # 5. MT_S_FIJOS.csv -> SELECCION == 'S' & CLIENTE FIJO 30% == 'SI'
        # -------------------------------------------------------------
        
        # Original Excel columns drop the temporary index helper
        df_export_base = df_aud.drop(columns=['idx_orig'])
        
        # 1. MT_T
        df_t = df_export_base[df_export_base[c['seleccion']].astype(str).str.strip().str.upper() == 'T']
        if len(df_t) > 0:
            fname = f"{aud_slug}_T.csv"
            df_t.to_csv(OUTPUT_DIR / fname, index=False, encoding='utf-8-sig')
            generated_files.append(fname)
            
        # 2. MT_T_ON
        df_t_on = df_t[df_t[c['tipo']].astype(str).str.strip().str.upper() == 'ON PREMISE']
        if len(df_t_on) > 0:
            fname = f"{aud_slug}_T_ON.csv"
            df_t_on.to_csv(OUTPUT_DIR / fname, index=False, encoding='utf-8-sig')
            generated_files.append(fname)
            
        # 3. MT_T_FIJOS
        df_t_fijos = df_t[df_t[c['fijo']].astype(str).str.strip().str.upper() == 'SI']
        if len(df_t_fijos) > 0:
            fname = f"{aud_slug}_T_FIJOS.csv"
            df_t_fijos.to_csv(OUTPUT_DIR / fname, index=False, encoding='utf-8-sig')
            generated_files.append(fname)

        # 4. MT_S
        df_s = df_export_base[df_export_base[c['seleccion']].astype(str).str.strip().str.upper() == 'S']
        if len(df_s) > 0:
            fname = f"{aud_slug}_S.csv"
            df_s.to_csv(OUTPUT_DIR / fname, index=False, encoding='utf-8-sig')
            generated_files.append(fname)

        # 5. MT_S_FIJOS
        df_s_fijos = df_s[df_s[c['fijo']].astype(str).str.strip().str.upper() == 'SI']
        if len(df_s_fijos) > 0:
            fname = f"{aud_slug}_S_FIJOS.csv"
            df_s_fijos.to_csv(OUTPUT_DIR / fname, index=False, encoding='utf-8-sig')
            generated_files.append(fname)

    # Also generate Master Consolidated CSV for Google My Maps
    if len(df_filtered) > 0:
        master_fname = "MASTER_GOOGLE_MYMAPS_TODOS.csv"
        df_master = df_filtered.drop(columns=['idx_orig']).copy()
        df_master.to_csv(OUTPUT_DIR / master_fname, index=False, encoding='utf-8-sig')
        generated_files.insert(0, master_fname)

    # Save to global state
    import datetime
    CURRENT_STATE['active_routes'] = auditor_routes
    CURRENT_STATE['generated_files'] = generated_files
    CURRENT_STATE['last_updated'] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    return jsonify({
        'success': True,
        'total_auditors': len(auditors),
        'total_filtered_points': len(df_filtered),
        'generated_files': generated_files,
        'master_file': 'MASTER_GOOGLE_MYMAPS_TODOS.csv',
        'auditor_routes': auditor_routes,
        'last_updated': CURRENT_STATE['last_updated']
    })

@app.route('/api/download-csv/<filename>')
def download_csv(filename):
    file_path = OUTPUT_DIR / filename
    if file_path.exists():
        return send_file(file_path, as_attachment=True, download_name=filename)
    return jsonify({'error': 'Archivo no encontrado'}), 404

@app.route('/api/download-zip')
def download_zip():
    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
        for f_path in OUTPUT_DIR.glob('*.csv'):
            zf.write(f_path, arcname=f_path.name)
    memory_file.seek(0)
    zip_name = f"Rutas_CSVs_Dia_{CURRENT_STATE['dia_campo']}.zip"
    return send_file(memory_file, mimetype='application/zip', as_attachment=True, download_name=zip_name)

@app.route('/api/auditor-data/<auditor_slug>')
def get_auditor_data(auditor_slug):
    routes = CURRENT_STATE.get('active_routes', {})
    if auditor_slug in routes:
        return jsonify(routes[auditor_slug])
    
    # Fuzzy match slug or return empty
    for k, v in routes.items():
        if auditor_slug in k or k in auditor_slug:
            return jsonify(v)
            
    return jsonify({
        'auditor_name': auditor_slug.replace('_', ' ').upper(),
        'slug': auditor_slug,
        'total_points': 0,
        'points': []
    })

@app.route('/api/dashboard-analytics', methods=['GET'])
def get_dashboard_analytics():
    excel_path = CURRENT_STATE['excel_path']
    df_univ, _ = load_dataset(excel_path)
    if df_univ is None:
        return jsonify({'error': 'Excel no encontrado'}), 404
        
    c = get_columns(df_univ)
    
    # Filter base points (MUESTRA CUMPL = Cargar)
    is_cargar = df_univ[c['muestra_cumpl']].astype(str).str.strip() == 'Cargar'
    df_base = df_univ[is_cargar].copy()
    
    # Is Visited flag (export.Estado is non-empty)
    df_base['is_visited'] = df_base[c['estado']].notna() & (df_base[c['estado']].astype(str).str.strip() != '') & (df_base[c['estado']].astype(str).str.strip() != 'nan')

    total_pts = len(df_base)
    visited_pts = int(df_base['is_visited'].sum())
    pending_pts = total_pts - visited_pts
    global_pct = round((visited_pts / total_pts * 100), 1) if total_pts > 0 else 0

    # 1. By Seleccion (T vs S)
    by_seleccion = {}
    for sel_val in ['T', 'S']:
        df_sel = df_base[df_base[c['seleccion']].astype(str).str.strip().str.upper() == sel_val]
        tot = len(df_sel)
        vis = int(df_sel['is_visited'].sum())
        pnd = tot - vis
        pct = round((vis / tot * 100), 1) if tot > 0 else 0
        by_seleccion[sel_val] = {
            'total': tot,
            'visited': vis,
            'pending': pnd,
            'pct': pct
        }

    # 2. By Dia de Campo
    by_day = []
    days = sorted([d for d in df_base[c['dia']].dropna().unique() if isinstance(d, (int, float))])
    for d in days:
        try:
            d_int = int(d)
        except (ValueError, TypeError):
            continue
        df_d = df_base[df_base[c['dia']] == d]
        tot = len(df_d)
        vis = int(df_d['is_visited'].sum())
        pnd = tot - vis
        pct = round((vis / tot * 100), 1) if tot > 0 else 0
        by_day.append({
            'dia': d_int,
            'total': tot,
            'visited': vis,
            'pending': pnd,
            'pct': pct
        })

    # 3. By Auditor
    by_auditor = []
    auditors = sorted([a for a in df_base[c['auditor']].dropna().unique() if str(a).strip() != ''])
    for aud in auditors:
        df_aud = df_base[df_base[c['auditor']] == aud]
        tot = len(df_aud)
        vis = int(df_aud['is_visited'].sum())
        pnd = tot - vis
        pct = round((vis / tot * 100), 1) if tot > 0 else 0

        # Fijos stats
        df_fijos = df_aud[df_aud[c['fijo']].astype(str).str.strip().str.upper() == 'SI']
        f_tot = len(df_fijos)
        f_vis = int(df_fijos['is_visited'].sum())
        f_pnd = f_tot - f_vis

        by_auditor.append({
            'auditor': str(aud),
            'slug': slugify(aud),
            'total': tot,
            'visited': vis,
            'pending': pnd,
            'pct': pct,
            'fijos_total': f_tot,
            'fijos_visited': f_vis,
            'fijos_pending': f_pnd
        })

    # 4. Estado Breakdown
    estado_counts = df_base[c['estado']].fillna('Pendiente').value_counts().to_dict()

    return jsonify({
        'global': {
            'total': total_pts,
            'visited': visited_pts,
            'pending': pending_pts,
            'pct': global_pct
        },
        'by_seleccion': by_seleccion,
        'by_day': by_day,
        'by_auditor': by_auditor,
        'estado_counts': estado_counts
    })

if __name__ == '__main__':
    print("==================================================")
    print(" RUTEADOR WEB INTELIGENTE - SERVIDOR INICIADO ")
    print(" Acceda a: http://localhost:5000")
    print("==================================================")
    app.run(host='0.0.0.0', port=5000, debug=True)
