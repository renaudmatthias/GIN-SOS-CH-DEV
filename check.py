import os
paths = [
    r'C:\Program Files\PostgreSQL\17\data\pg_hba.conf',
    r'C:\Program Files\PostgreSQL\17\data\pg_ident.conf',
    r'C:\Program Files\PostgreSQL\17\data\postgresql.conf',
    os.path.expanduser('~') + r'\AppData\Roaming\postgresql\pgpass.conf',
]
for p in paths:
    try:
        with open(p, 'rb') as f:
            d = f.read()
        print(f'OK  {p}  ({len(d)} bytes)')
        try:
            d.decode('utf-8')
        except Exception as e:
            print(f'  --> PROBLEME: {e}')
            # Trouver le byte exact et son contexte
            pos = int(str(e).split('position ')[1].split(':')[0])
            print(f'  --> Contexte: {d[max(0,pos-20):pos+20]}')
    except FileNotFoundError:
        print(f'--  {p}  (absent)')
    except PermissionError:
        print(f'XX  {p}  (permission refusee)')