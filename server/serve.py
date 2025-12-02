#!/usr/bin/env python3
import http.server
import socketserver
import webbrowser
import os
import sys

PORT = 8080
script_dir = os.path.dirname(os.path.abspath(__file__))
site_dir = os.path.join(os.path.dirname(script_dir), 'site')

if not os.path.exists(site_dir):
    print(f'Error: {site_dir} not found!')
    print('Please run compile.r first to build the site.')
    sys.exit(1)

os.chdir(site_dir)
Handler = http.server.SimpleHTTPRequestHandler

print('=' * 60)
print('RAVE Portable Server')
print('=' * 60)
print(f'Server running at http://localhost:{PORT}')
print('Press Ctrl+C to stop.')
print('=' * 60)
print()

with socketserver.TCPServer(('', PORT), Handler) as httpd:
    webbrowser.open(f'http://localhost:{PORT}')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nShutting down server...')
        print('Goodbye!')
