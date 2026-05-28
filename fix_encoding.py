import ctypes
# Force Windows à utiliser UTF-8 pour les appels C (code page 65001)
ctypes.windll.kernel32.SetConsoleCP(65001)
ctypes.windll.kernel32.SetConsoleOutputCP(65001)

# Patch critique : force l'encodage du filesystem Python à UTF-8
import _locale
_locale._getdefaultlocale = lambda *args: ('fr_FR', 'utf-8')

# Maintenant importer psycopg2
import psycopg2
conn = psycopg2.connect(
    host='localhost', port=5432,
    dbname='sosdb', user='postgres', password='postgres'
)
print('OK', conn.status)
conn.close()