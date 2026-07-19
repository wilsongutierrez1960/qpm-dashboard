#!/bin/bash
cd "$(dirname "$0")"
echo "Instalando dependencias (si faltan)..."
pip3 install flask flask-cors requests --quiet --break-system-packages
echo ""
echo "Iniciando servidor QPM en http://127.0.0.1:5000"
echo "Dejar esta terminal abierta mientras uses el dashboard."
echo ""
( sleep 1 && xdg-open http://127.0.0.1:5000 >/dev/null 2>&1 ) &
python3 servidor.py
