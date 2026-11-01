/* Controls of the NYC weather page; the charts are in figures.js */

const element = id => document.getElementById(id);
const plotConfig = {responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d', 'select2d']};
const fontFamily = '"Source Sans 3", "Source Sans Pro", sans-serif';

// What Streamlit's chart theme adds to the figures; anything set in a figure takes priority
const plotTemplate = {
    layout: {
        font: {family: fontFamily, size: 12},
        margin: {pad: 8},
        xaxis: {automargin: true, title: {font: {size: 14}, standoff: 24}},
        yaxis: {automargin: true, title: {font: {size: 14}, standoff: 32}},
        hoverlabel: {bgcolor: '#1d2133', bordercolor: grid, font: {color: ink, family: fontFamily, size: 12}},
    },
};

let df = [];
let firstYear = 0;
let lastYear = 0;
let activeTab = 'daylight';


function draw(id, figure) {
    /* Draw a figure, replacing whatever was there */
    Plotly.newPlot(element(id), figure.data, {...figure.layout, template: plotTemplate}, plotConfig);
}


function selectedRows() {
    /* Return the data for the selected years, or null if the range is invalid */
    const start = Number(element('start-year').value);
    const stop = Number(element('stop-year').value);
    const valid = start <= stop;
    element('year-error').hidden = valid;
    return valid ? df.filter(row => dateYear(row.date) >= start && dateYear(row.date) <= stop) : null;
}


function showDaylight() {
    draw('daylight-plot', element('daylight-radial').checked ? daylightRadialFigure(df) : daylightFigure(df));
}


function showTemperature(selected) {
    const normals = dailyNormals(selected);
    const radial = element('temperature-radial').checked;
    if (element('individual-years').checked) {
        const table = yearlyMeans(selected);
        draw('temperature-plot', radial ? yearlyRadialFigure(table) : yearlyFigure(table));
    } else {
        draw('temperature-plot', radial ? temperatureRadialFigure(normals) : temperatureFigure(normals));
    }
    const typical = typicalPeriod(normals);
    const actual = actualPeriod(selected);
    element('periods').replaceChildren(...['warmest', 'coldest'].map(label => {
        const item = document.createElement('p');
        const title = document.createElement('strong');
        title.textContent = `${label[0].toUpperCase()}${label.slice(1)} ${windowDays} days:`;
        const usual = `Average year: ${typical[label].dates} (${typical[label].temperature.toFixed(1)} °C)`;
        item.append(title, ` ${actual[label].dates} (${actual[label].temperature.toFixed(1)} °C)`, document.createElement('br'), usual);
        return item;
    }));
}


function showPrecipitation(selected) {
    const kind = document.querySelector('input[name="precipitation-kind"]:checked').value;
    const chart = element('as-graphs').checked ? precipitationBars : precipitationFigure;
    draw('precipitation-plot', chart(dayChances(selected, kind), kind));
}


function showExplorations(selected) {
    draw('explorations-plot', temperatureDaylightFigure(dailyNormals(selected, ['tmax_c', 'daylight_hours'])));
}


function render() {
    /* Draw the active tab; hidden tabs wait until they are opened, since Plotly can't size a hidden chart */
    const selected = selectedRows();
    const needsYears = activeTab !== 'daylight';
    for (const panel of document.querySelectorAll('[role="tabpanel"]')) {
        panel.hidden = panel.id !== `${activeTab}-panel`;
    }
    element(`${activeTab}-panel`).querySelector('.panel-body').hidden = needsYears && selected === null;
    if (activeTab === 'daylight') {
        showDaylight();
    } else if (selected !== null) {
        ({temperature: showTemperature, precipitation: showPrecipitation, explorations: showExplorations})[activeTab](selected);
    }
}


function selectTab(tab) {
    /* Switch to a tab */
    activeTab = tab.dataset.tab;
    for (const other of document.querySelectorAll('[role="tab"]')) {
        other.setAttribute('aria-selected', String(other === tab));
    }
    render();
}


function clipYear(input, fallback) {
    /* Keep a typed year within the data; a blank box goes back to the fallback */
    const value = input.value === '' ? fallback : Number(input.value);
    input.value = Math.min(Math.max(Math.trunc(value), firstYear), lastYear);
}


async function main() {
    const response = await fetch('weather.csv');
    if (!response.ok) {
        throw new Error(`weather.csv: ${response.status}`);
    }
    df = parseData(await response.text());
    firstYear = dateYear(df[0].date);
    lastYear = dateYear(df.at(-1).date);

    for (const [id, value] of [['start-year', firstYear], ['stop-year', lastYear - 1]]) {
        const input = element(id);
        Object.assign(input, {min: firstYear, max: lastYear, value});
        input.addEventListener('change', () => {
            clipYear(input, value);
            render();
        });
    }
    for (const input of document.querySelectorAll('.panel-body input')) {
        input.addEventListener('change', render);
    }
    for (const tab of document.querySelectorAll('[role="tab"]')) {
        tab.addEventListener('click', () => selectTab(tab));
    }
    element('daylight-caption').textContent = `Sunrise to sunset in New York, ${daylightYear}, in local clock time`;
    element('loading').hidden = true;
    render();
}


main().catch(error => {
    element('loading').textContent = `Could not load the dashboard (${error.message}).`;
});
