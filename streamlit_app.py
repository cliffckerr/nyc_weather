"""
Streamlit dashboard of NYC daily weather. Run with: streamlit run app.py
"""
from pathlib import Path

import pandas as pd
import plotly.colors as pc
import plotly.graph_objects as go
import streamlit as st

data_file = Path(__file__).parent / 'data' / 'nyc_weather_metric.csv'
daylight_year = 2025
window = 90  # Days in the warmest/coldest periods
colormap = 'Turbo'  # For the individual years
temperature_label = 'Temperature (°C)'
daylight_outer = 29  # Hours at the end of the radial daylight axis, which puts the month labels clear of the event labels outside the 24:00 rim
radial_rim = 30  # °C at the edge of the radial charts; lines may run past it
radial_rim_limit = 35  # Above this temperature, the rim moves out to the next multiple of 10 °C
leap_year = 2024  # Placeholder year that has a Feb 29, for charts of the precipitation calendar

# Colors, also set in .streamlit/config.toml
night = '#2b3147'
gold = '#f2bb3d'
warm = '#e0672f'
cool = '#4493dc'
ink = '#e8e9ee'
muted = '#a4a9b8'
grid = '#3a4158'
band_color = 'rgba(242,187,61,0.16)'
snow_white = '#ffffff'

# Local dates in New York for the daylight year; the DST dates are checked against the data
events = {
    f'{daylight_year}-03-09': 'Clocks forward',
    f'{daylight_year}-03-20': 'Spring equinox',
    f'{daylight_year}-06-20': 'Summer solstice',
    f'{daylight_year}-09-22': 'Fall equinox',
    f'{daylight_year}-11-02': 'Clocks back',
    f'{daylight_year}-12-21': 'Winter solstice',
}


@st.cache_data
def load_data():
    """Load the daily weather data"""
    return pd.read_csv(data_file, parse_dates=['date'], index_col='date')


def clock_hours(times):
    """Convert 'HH:MM' strings to decimal hours"""
    parts = times.str.split(':', expand=True).astype(int)
    return parts[0] + parts[1] / 60


def daylight_figure(df):
    """Make one horizontal bar per day from sunrise to sunset, with Jan 1 at the top"""
    year = df.loc[str(daylight_year)]
    rise = clock_hours(year.sunrise)
    days = list(range(len(year)))
    fig = go.Figure(go.Bar(
        y=days, x=clock_hours(year.sunset) - rise, base=rise, orientation='h', marker=dict(color=gold, line_width=0),
        customdata=list(zip(year.index.strftime('%b %-d'), year.sunrise, year.sunset, year.daylight_hours)),
        hovertemplate='<b>%{customdata[0]}</b><br>Sunrise %{customdata[1]}<br>Sunset %{customdata[2]}<br>%{customdata[3]:.1f} h daylight<extra></extra>',
    ))
    for date, label in events.items():
        y = year.index.get_loc(pd.Timestamp(date))
        fig.add_shape(type='line', x0=0, x1=24, y0=y, y1=y, line=dict(color=ink, width=1, dash='dot'))
        fig.add_annotation(x=1, xref='paper', y=y, text=f'{label}, {pd.Timestamp(date).strftime("%b %-d")}', showarrow=False, xanchor='left', xshift=8, font=dict(color=ink, size=12))
    month_starts = year.index[year.index.day == 1]
    fig.update_yaxes(
        range=[len(year) - 0.5, -0.5], tickvals=[year.index.get_loc(d) for d in month_starts],
        ticktext=month_starts.strftime('%b').tolist(), ticks='outside', ticklen=4, tickcolor=muted, showgrid=False, zeroline=False,
    )
    fig.update_xaxes(
        range=[0, 24], tickvals=list(range(0, 25, 3)), ticktext=[f'{h:02d}:00' for h in range(0, 25, 3)],
        side='top', showgrid=True, gridcolor=grid, zeroline=False,
    )
    fig.update_layout(
        height=860, bargap=0.2, plot_bgcolor=night, paper_bgcolor='rgba(0,0,0,0)', font=dict(color=ink),
        margin=dict(l=45, r=170, t=30, b=10), showlegend=False, hovermode='y',
    )
    return fig


def daylight_radial_figure(df):
    """Make one wedge per day from sunrise to sunset, with midnight at the center and Jan 1 at the top, running clockwise"""
    year = df.loc[str(daylight_year)]
    rise = clock_hours(year.sunrise)
    theta = day_angles(year.index)
    fig = go.Figure(go.Barpolar(
        r=clock_hours(year.sunset) - rise, base=rise, theta=theta, width=360 / 365, marker=dict(color=gold, line=dict(color=gold, width=0.5)),  # The outline closes the seams between wedges
        customdata=list(zip(year.index.strftime('%b %-d'), year.sunrise, year.sunset, year.daylight_hours)),
        hovertemplate='<b>%{customdata[0]}</b><br>Sunrise %{customdata[1]}<br>Sunset %{customdata[2]}<br>%{customdata[3]:.1f} h daylight<extra></extra>',
    ))
    for date, label in events.items():
        angle = day_angles(pd.DatetimeIndex([date]))[0]
        fig.add_scatterpolar(r=[0, 24], theta=[angle, angle], mode='lines', line=dict(color=ink, width=1, dash='dot'), hoverinfo='skip')
        fig.add_scatterpolar(
            r=[24.5], theta=[angle], mode='text', text=[f'{label}, {pd.Timestamp(date).strftime("%b %-d")}'], hoverinfo='skip',
            textposition=f'middle {"right" if angle < 180 else "left"}', textfont=dict(color=ink, size=12),
        )
    hours = list(range(0, 25, 3))
    labels = [f'{hour:02d}:00' for hour in hours]
    fig.add_scatterpolar(  # Drawn as text rather than axis labels, so that those over the daylight can be dark
        r=hours, theta=[0] * len(hours), mode='text', text=labels, textposition='middle right', hoverinfo='skip',
        textfont=dict(size=11, color=[night if rise.iloc[0] < hour < clock_hours(year.sunset).iloc[0] else muted for hour in hours]),
    )
    style_radial_figure(fig, hours, labels, outer=daylight_outer)
    fig.update_polars(radialaxis_showticklabels=False)
    return fig.update_layout(height=860, showlegend=False)


def daily_normals(df, columns=('tmin_c', 'tmax_c')):
    """Average the columns for each calendar day; Feb 29 is left out to give a fixed 365-day year"""
    df = df[~((df.index.month == 2) & (df.index.day == 29))]
    normals = df.groupby(df.index.strftime('%m-%d'))[list(columns)].mean()
    dates = pd.date_range('2025-01-01', '2025-12-31', name='date')  # 2025 is only a placeholder non-leap year
    normals = normals.reindex(dates.strftime('%m-%d'))  # Days without data, as in a partial year, stay as NaN
    normals.index = dates
    return normals


def temperature_figure(normals):
    """Plot the average min and max as two lines with the range filled between"""
    fig = go.Figure()
    fig.add_scatter(x=normals.index, y=normals.tmin_c, name='Average min', line=dict(color=cool, width=2), hovertemplate='%{y:.1f} °C')
    fig.add_scatter(
        x=normals.index, y=normals.tmax_c, name='Average max', line=dict(color=warm, width=2), hovertemplate='%{y:.1f} °C',
        fill='tonexty', fillcolor=band_color,
    )
    return style_year_figure(fig, temperature_label).update_layout(hovermode='x unified', legend=dict(orientation='h', x=0, y=1.1))


def temperature_radial_figure(normals):
    """Plot the average min and max around the circle with the range filled between, joining Dec 31 to Jan 1 for a full year"""
    closed = normals.dropna()
    theta = [*day_angles(closed.index)]
    labels = [*closed.index.strftime('%b %-d')]
    if len(closed) == 365:
        closed = pd.concat([closed, closed.iloc[:1]])
        theta.append(360)
        labels.append(labels[0])
    fig = go.Figure()
    fig.add_scatterpolar(  # A loop out along the max and back along the min, which leaves a ring to fill
        r=[*closed.tmax_c, *closed.tmin_c[::-1]], theta=[*theta, *theta[::-1]], mode='none', fill='toself', fillcolor=band_color, hoverinfo='skip', showlegend=False,
    )
    for column, name, color in [('tmin_c', 'Average min', cool), ('tmax_c', 'Average max', warm)]:
        fig.add_scatterpolar(
            r=closed[column], theta=theta, name=name, mode='lines', line=dict(color=color, width=2),
            customdata=labels, hovertemplate='%{customdata}: %{r:.1f} °C',
        )
    return style_radial_temperature(fig, closed.tmin_c.min(), closed.tmax_c.max()).update_layout(legend=dict(orientation='h', x=0, y=1.08))


def yearly_means(df):
    """Make a table of the daily mean temperature with one row per calendar day and one column per year; Feb 29 is left out"""
    df = df[~((df.index.month == 2) & (df.index.day == 29))]
    means = df[['tmin_c', 'tmax_c']].mean(axis=1)
    table = means.groupby([means.index.strftime('%m-%d'), means.index.year]).first().unstack()
    dates = pd.date_range('2025-01-01', '2025-12-31', name='date')  # 2025 is only a placeholder non-leap year
    table = table.reindex(dates.strftime('%m-%d'))  # Days without data, as in a partial year, stay as NaN
    table.index = dates
    return table


def year_color(year, first, last):
    """Pick the color of a year from the colormap"""
    return pc.sample_colorscale(colormap, [(year - first) / max(last - first, 1)])[0]


def year_colorbar(first, last):
    """Make the marker settings for an invisible trace that exists only to draw the colorbar"""
    return dict(colorscale=colormap, cmin=first, cmax=last, color=[first], showscale=True, colorbar=dict(title='Year', tickformat='d', outlinewidth=0))


def yearly_figure(table):
    """Plot one line per year, colored from earliest to latest, with a colorbar in place of a legend"""
    first, last = int(table.columns.min()), int(table.columns.max())
    fig = go.Figure()
    for year in table.columns:
        fig.add_scattergl(
            x=table.index, y=table[year], name=str(year), mode='lines', line=dict(color=year_color(year, first, last), width=1), opacity=0.7,
            hovertemplate='%{x|%b %-d}, %{fullData.name}: %{y:.1f} °C<extra></extra>',
        )
    fig.add_scatter(x=[None], y=[None], mode='markers', showlegend=False, hoverinfo='skip', marker=year_colorbar(first, last))
    return style_year_figure(fig, temperature_label).update_layout(hovermode='closest', showlegend=False)


def yearly_radial_figure(table):
    """Plot one line per year around the circle, colored from earliest to latest, with a colorbar in place of a legend"""
    first, last = int(table.columns.min()), int(table.columns.max())
    theta = day_angles(table.index)
    labels = table.index.strftime('%b %-d')
    fig = go.Figure()
    for year in table.columns:
        fig.add_scatterpolar(  # Not WebGL, which would hide the axis labels
            r=table[year], theta=theta, name=str(year), mode='lines', line=dict(color=year_color(year, first, last), width=1), opacity=0.7,
            customdata=labels, hovertemplate='%{customdata}, %{fullData.name}: %{r:.1f} °C<extra></extra>',
        )
    fig.add_scatterpolar(r=[None], theta=[None], mode='markers', showlegend=False, hoverinfo='skip', marker=year_colorbar(first, last))
    return style_radial_temperature(fig, table.min().min(), table.max().max()).update_layout(showlegend=False)


def day_angles(dates):
    """Convert dates to degrees clockwise from Jan 1 at the top of a 365-day circle"""
    return (dates.dayofyear - 1) / 365 * 360


def style_radial_temperature(fig, lowest, highest):
    """Set up a temperature chart with circles every 10 °C; the center is the lowest value rounded down to a multiple of 10 °C"""
    center = int(lowest // 10 * 10)
    rim = radial_rim if highest <= radial_rim_limit else int(-(-highest // 10) * 10)
    circles = list(range(center, rim + 1, 10))
    labels = [f'{circle} °C'.replace('-', '−') for circle in circles]
    return style_radial_figure(fig, circles, labels, outer=max(rim, radial_rim_limit), thick_circle=0)


def style_radial_figure(fig, circles, labels, outer, thick_circle=None):
    """Apply the labeled circles, the month spokes, and the layout shared by the radial charts; the first circle is the center and the last is the rim, with the axis running on to outer"""
    center, rim = circles[0], circles[-1]
    month_starts = pd.date_range('2025-01-01', '2025-12-01', freq='MS')  # 2025 is only a placeholder non-leap year
    angles = day_angles(month_starts)

    # Plotly cuts lines off at the end of the axis, so the axis can run past the rim, and the rim and spokes are drawn as traces
    spokes = pd.DataFrame({'r': [center, rim, None] * len(angles), 'theta': [angle for angle in angles for _ in range(3)]})
    guides = [
        dict(r=spokes.r, theta=spokes.theta, line=dict(color=grid, width=1), connectgaps=False),
        dict(r=[rim] * 361, theta=list(range(361)), line=dict(color=muted, width=1)),
    ]
    if thick_circle is not None:
        guides.append(dict(r=[thick_circle] * 361, theta=list(range(361)), line=dict(color=muted, width=3)))
    for guide in guides:
        fig.add_scatterpolar(mode='lines', hoverinfo='skip', showlegend=False, **guide)
    fig.data = fig.data[-len(guides):] + fig.data[:-len(guides)]  # Draw them under the data

    fig.update_polars(
        bgcolor='rgba(0,0,0,0)',
        radialaxis=dict(
            range=[center, outer], tickvals=circles, ticktext=labels, angle=90, tickangle=90,
            gridcolor=grid, showline=False, tickfont=dict(color=muted),
        ),
        angularaxis=dict(rotation=90, direction='clockwise', tickvals=angles, ticktext=month_starts.strftime('%b').tolist(), ticks='', showgrid=False, showline=False),
    )
    fig.update_layout(
        height=760, paper_bgcolor='rgba(0,0,0,0)', font=dict(color=ink), margin=dict(l=40, r=40, t=70, b=40), hovermode='closest',
    )
    return fig


def style_year_figure(fig, y_title, year=2025):
    """Apply the January to December x-axis and the layout shared by the charts of a year"""
    fig.update_xaxes(tickformat='%b', dtick='M1', tick0=f'{year}-01-01', hoverformat='%b %-d', showgrid=True, gridcolor=grid, gridwidth=0.5, range=[f'{year}-01-01', f'{year}-12-31'])
    fig.update_yaxes(title=y_title, gridcolor=grid, zeroline=True, zerolinecolor=muted, zerolinewidth=1)
    fig.update_layout(
        height=520, plot_bgcolor='rgba(0,0,0,0)', paper_bgcolor='rgba(0,0,0,0)', font=dict(color=ink),
        margin=dict(l=55, r=20, t=40, b=30),
    )
    return fig


def typical_period(normals):
    """Find the warmest and coldest window in the average year, which can wrap past Dec 31"""
    mean = normals.mean(axis=1)
    wrapped = pd.concat([mean, mean.iloc[:window - 1]], ignore_index=True)
    rolling = wrapped.rolling(window).mean().dropna()  # Labeled by the last day of each window
    out = {}
    for label, last in [('warmest', rolling.idxmax()), ('coldest', rolling.idxmin())]:
        start = normals.index[(last - window + 1) % len(normals)]
        stop = normals.index[last % len(normals)]
        out[label] = f'{start:%b %-d} to {stop:%b %-d}', rolling[last]
    return out


def actual_period(df):
    """Find the warmest and coldest consecutive days that really occurred in the selected years"""
    rolling = df[['tmin_c', 'tmax_c']].mean(axis=1).rolling(window).mean().dropna()
    out = {}
    for label, stop in [('warmest', rolling.idxmax()), ('coldest', rolling.idxmin())]:
        start = stop - pd.Timedelta(days=window - 1)
        out[label] = f'{start:%Y-%m-%d} to {stop:%Y-%m-%d}', rolling[stop]
    return out


def temperature_daylight_figure(normals):
    """Plot the average max temperature on the left axis and the hours of daylight on the right axis"""
    fig = go.Figure()
    fig.add_scatter(x=normals.index, y=normals.tmax_c, name='Average max temperature', line=dict(color=warm, width=2), hovertemplate='%{y:.1f} °C')
    fig.add_scatter(x=normals.index, y=normals.daylight_hours, name='Daylight', yaxis='y2', line=dict(color=gold, width=2), hovertemplate='%{y:.1f} h')
    style_year_figure(fig, 'Average max temperature (°C)')
    fig.update_yaxes(title_font_color=warm)
    return fig.update_layout(
        yaxis2=dict(title='Daylight (hours)', title_font_color=gold, overlaying='y', side='right', showgrid=False, zeroline=False),
        hovermode='x unified', legend=dict(orientation='h', x=0, y=1.1), margin_r=60,
    )


def day_chances(df, kind):
    """Make a table of the chance of the kind of precipitation (%) with one row per month and one column per day of the month"""
    snowed = df.snow_cm > 0
    happened = snowed if kind == 'Snowfall' else (df.precip_mm > 0) & ~snowed  # A day with both counts as snow
    chances = happened.groupby([happened.index.month, happened.index.day]).mean().mul(100).unstack()
    return chances.reindex(index=range(1, 13), columns=range(1, 32))  # Days that don't exist stay as NaN


def percent_label(value):
    """Format a percentage to the nearest whole number, or to 1 significant figure below 10%; blank if there is no value"""
    if pd.isna(value):
        return ''
    return f'{value:.1g}%' if value < 9.5 else f'{value:.0f}%'  # At 9.5 and up, .1g would give 1e+01


def precipitation_figure(chances, kind):
    """Draw a calendar grid with one box per day, shaded in proportion to the chance: blue for rain, white for snow"""
    snowfall = kind == 'Snowfall'
    color, noun = (snow_white, 'snow') if snowfall else (cool, 'rain')
    months = [f'{pd.Timestamp(2024, month, 1):%b}' for month in chances.index]
    labels = chances.map(percent_label)
    peak = chances.max().max()
    pale = chances >= 0.4 * peak if snowfall else chances < 0  # Boxes that need dark text; Plotly's automatic contrast fails on mid-greys, and all rain boxes suit light text
    text = labels.where(~pale, f'<span style="color:{night}">' + labels + '</span>')
    fig = go.Figure(go.Heatmap(
        z=chances.values, x=chances.columns, y=months, text=text.values, texttemplate='%{text}', textfont=dict(size=11, color=ink), customdata=labels.values,
        colorscale=[[0, night], [1, color]], zmin=0, zmax=peak, showscale=False, xgap=2, ygap=2, hoverongaps=False,
        hovertemplate=f'%{{y}} %{{x}}: %{{customdata}} chance of {noun}<extra></extra>',
    ))
    fig.update_xaxes(side='top', dtick=1, showgrid=False, zeroline=False, ticks='', range=[0.5, 31.5])
    fig.update_yaxes(autorange='reversed', showgrid=False, zeroline=False, ticks='')
    fig.update_layout(
        height=560, plot_bgcolor='rgba(0,0,0,0)', paper_bgcolor='rgba(0,0,0,0)', font=dict(color=ink),
        margin=dict(l=45, r=10, t=30, b=10),
    )
    return fig


def precipitation_bars(chances, kind):
    """Plot the chance for each calendar day as a bar, from January to December"""
    color, noun = (snow_white, 'snow') if kind == 'Snowfall' else (cool, 'rain')
    days = chances.stack().dropna()  # Drop days that don't exist
    dates = pd.to_datetime([f'{leap_year}-{month:02d}-{day:02d}' for month, day in days.index])
    fig = go.Figure(go.Bar(
        x=dates, y=days.values, marker=dict(color=color, line_width=0), customdata=days.map(percent_label).values,
        hovertemplate=f'%{{customdata}} chance of {noun}<extra></extra>',
    ))
    return style_year_figure(fig, f'Chance of {noun} (%)', leap_year).update_layout(bargap=0, hovermode='x unified', showlegend=False)


def clip_year(key, first):
    """Raise a year typed in below the first year of data up to that year"""
    st.session_state[key] = max(st.session_state[key], first)


def select_years(df):
    """Show the year controls, returning the data for the selected years, or None if the range is invalid"""
    first, last = int(df.index.year.min()), int(df.index.year.max())
    left, right, _ = st.columns([1, 1, 4])
    start = left.number_input('Start year', max_value=last, value=first, key='start_year', on_change=clip_year, args=('start_year', first))
    stop = right.number_input('Stop year', max_value=last, value=last - 1, key='stop_year', on_change=clip_year, args=('stop_year', first))
    if start > stop:
        st.error('Start year must not be after stop year.')
        return None
    return df.loc[str(start):str(stop)]


def temperature_tab(selected):
    """Show the chart and the warmest and coldest periods"""
    controls = st.container(horizontal=True)
    individual = controls.toggle('Show individual years')
    radial = controls.toggle('Radial')
    normals = daily_normals(selected)
    if individual:
        table = yearly_means(selected)
        figure = yearly_radial_figure(table) if radial else yearly_figure(table)
    else:
        figure = temperature_radial_figure(normals) if radial else temperature_figure(normals)
    st.plotly_chart(figure, width='stretch')
    typical = typical_period(normals)
    actual = actual_period(selected)
    with st.container(border=True):
        for label in ['warmest', 'coldest']:
            dates, temp = actual[label]
            usual_dates, usual_temp = typical[label]
            st.markdown(
                f'**{label.title()} {window} days:** {dates} ({temp:.1f} °C)  \n'
                f'Average year: {usual_dates} ({usual_temp:.1f} °C)'
            )
        st.caption('Temperature is the mean of daily min and max. Dated periods are the most extreme consecutive days within the selected years.')


def precipitation_tab(selected):
    """Show the calendar of the chance of rain or snow"""
    controls = st.container(horizontal=True, vertical_alignment='center')
    kind = controls.segmented_control('Precipitation type', ['Rainfall', 'Snowfall'], default='Rainfall', required=True, label_visibility='collapsed')
    as_graphs = controls.toggle('As graphs')
    draw = precipitation_bars if as_graphs else precipitation_figure
    st.plotly_chart(draw(day_chances(selected, kind), kind), width='stretch')
    st.caption('Share of the selected years with any rain or snow recorded on that day; trace amounts are not counted, and a day with both counts as snowfall. Feb 29 uses leap years only.')


def explorations_tab(selected):
    """Show the exploratory charts"""
    normals = daily_normals(selected, ['tmax_c', 'daylight_hours'])
    st.plotly_chart(temperature_daylight_figure(normals), width='stretch')


def main():
    st.set_page_config(page_title='NYC weather', layout='wide')
    st.title('NYC weather')
    df = load_data()
    selected = select_years(df)
    daylight, temperature, precipitation, explorations = st.tabs(['Daylight', 'Temperature', 'Precipitation', 'Explorations'])
    with daylight:
        st.caption(f'Sunrise to sunset in New York, {daylight_year}, in local clock time')
        radial = st.toggle('Radial', key='daylight_radial')
        st.plotly_chart(daylight_radial_figure(df) if radial else daylight_figure(df), width='stretch')
    if selected is not None:
        with temperature:
            temperature_tab(selected)
        with precipitation:
            precipitation_tab(selected)
        with explorations:
            explorations_tab(selected)


if __name__ == '__main__':
    main()
