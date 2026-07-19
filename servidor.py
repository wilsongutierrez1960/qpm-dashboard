"""
Proxy server-side para FRED API.
Evita el bloqueo CORS haciendo el fetch desde Python (servidor) en vez del navegador.
El navegador llama a este servidor local; este servidor llama a FRED.
"""

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import requests
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__)
CORS(app)  # permite requests desde cualquier origen local (dev only)

FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"


@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/api/fred/<series_id>")
def fred_series(series_id):
    """
    Reenvia TODOS los query params recibidos hacia FRED, agregando series_id.
    Ejemplo de uso desde el navegador:
    http://localhost:5000/api/fred/GDPC1?api_key=TU_API_KEY&observation_start=2000-01-01&frequency=q&aggregation_method=avg
    """
    api_key = request.args.get("api_key")

    if not api_key:
        return jsonify({"error": "Falta el parametro api_key"}), 400

    # Reenvia todos los params tal cual (frequency, aggregation_method, observation_start, etc.)
    params = dict(request.args)
    params["series_id"] = series_id
    params.setdefault("file_type", "json")

    try:
        resp = requests.get(FRED_BASE, params=params, timeout=15)
        resp.raise_for_status()
        return jsonify(resp.json())
    except requests.exceptions.HTTPError as e:
        # FRED devuelve 400 con detalle si el api_key o series_id estan mal
        return jsonify({"error": "FRED rechazo la request", "detalle": resp.text}), resp.status_code
    except requests.exceptions.RequestException as e:
        return jsonify({"error": f"Fallo de conexion: {str(e)}"}), 502


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    index_path = os.path.join(BASE_DIR, "index.html")
    if not os.path.isfile(index_path):
        print(f"ATENCION: no encuentro index.html en {BASE_DIR}")
        print("Asegurate de que index.html este en la MISMA carpeta que servidor.py")
    print("Servidor QPM corriendo en http://127.0.0.1:5000")
    print("Endpoint proxy: http://127.0.0.1:5000/api/fred/<series_id>?api_key=...")
    app.run(host="127.0.0.1", port=5000, debug=False)
