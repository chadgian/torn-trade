import runpy

g=runpy.run_path('.github/scripts/v022_bento_ui.py')
g['p'].write_text(g['s'])
