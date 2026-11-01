# NYC weather

A Streamlit dashboard of daily weather in New York City (Central Park) from 1975 onward, with tabs for daylight, temperature, precipitation, and explorations.

## Usage

```bash
pip install -r requirements.txt
streamlit run app.py
```

The merged data is in the repo, so the dashboard works straight away.

## Updating the data

```bash
python get_weather.py
```

This writes `data/nyc_weather.csv` and `data/nyc_weather_metric.csv`, the latter being what the dashboard reads. Raw downloads go in `data/raw/`, which isn't tracked, and are reused if present, so delete them to get newer data.

## Data sources

- **Station data:** [NOAA GHCN-Daily](https://www.ncei.noaa.gov/products/land-based-station/global-historical-climatology-network-daily), Central Park station USW00094728 (measured).
- **ERA5 data:** [Open-Meteo archive](https://open-meteo.com/en/docs/historical-weather-api), ERA5 reanalysis (modeled, on a grid of about 25 km).

## AI disclosure

[*Authorship*: 🧠 3%, 🤖 97%](# "Vibecoded based on my prompts and feedback")
