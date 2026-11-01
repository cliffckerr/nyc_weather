"""
Check that the static site matches the Streamlit app, by building every figure both ways and comparing them.

Run with: python docs/compare_figures.py (needs Node, and the packages in requirements.txt)
"""
import base64
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
from plotly.utils import PlotlyJSONEncoder

docs_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(docs_dir.parent))
import streamlit_app as app

year_ranges = [(1975, 2025), (1990, 2000), (2026, 2026), (1975, 2026), (2000, 2000), (2020, 2026), (2015, 2019), (1985, 2024)]


def clean(value):
    """Turn a figure into plain JSON values: decode Plotly's base64 arrays, and drop the template, which the site sets separately"""
    if isinstance(value, dict):
        if 'bdata' in value and 'dtype' in value:
            array = np.frombuffer(base64.b64decode(value['bdata']), dtype=value['dtype'])
            if 'shape' in value:
                array = array.reshape([int(size) for size in str(value['shape']).split(',')])
            return clean(array.tolist())
        return {key: clean(item) for key, item in value.items() if key != 'template'}
    if isinstance(value, list):
        return [clean(item) for item in value]
    if isinstance(value, float) and value != value:
        return None
    return value


def figure_json(figure):
    """Convert a Plotly figure to plain JSON values"""
    return clean(json.loads(json.dumps(figure.to_dict(), cls=PlotlyJSONEncoder)))


def period_json(period):
    """Convert the warmest and coldest periods to plain JSON values"""
    return {label: [dates, float(temperature)] for label, (dates, temperature) in period.items()}


def year_case(selected, start, stop):
    """Build everything that depends on the selected years"""
    normals = app.daily_normals(selected)
    table = app.yearly_means(selected)
    figures = {
        'temperatureFigure': app.temperature_figure(normals),
        'temperatureRadialFigure': app.temperature_radial_figure(normals),
        'yearlyFigure': app.yearly_figure(table),
        'yearlyRadialFigure': app.yearly_radial_figure(table),
        'temperatureDaylightFigure': app.temperature_daylight_figure(app.daily_normals(selected, ['tmax_c', 'daylight_hours'])),
    }
    for kind in ['Rainfall', 'Snowfall']:
        chances = app.day_chances(selected, kind)
        figures[f'precipitationFigure{kind}'] = app.precipitation_figure(chances, kind)
        figures[f'precipitationBars{kind}'] = app.precipitation_bars(chances, kind)
    return dict(
        start=start, stop=stop, figures={name: figure_json(figure) for name, figure in figures.items()},
        typical=period_json(app.typical_period(normals)), actual=period_json(app.actual_period(selected)),
    )


def main():
    df = pd.read_csv(app.data_file, parse_dates=['date'], index_col='date')
    reference = dict(
        daylightFigure=figure_json(app.daylight_figure(df)),
        daylightRadialFigure=figure_json(app.daylight_radial_figure(df)),
        cases=[year_case(df.loc[str(start):str(stop)], start, stop) for start, stop in year_ranges],
    )
    with tempfile.TemporaryDirectory() as folder:
        file = Path(folder) / 'reference.json'
        file.write_text(json.dumps(reference))
        sys.exit(subprocess.run(['node', str(docs_dir / 'compare_figures.js'), str(file)]).returncode)


if __name__ == '__main__':
    main()
