document.addEventListener('DOMContentLoaded', async function () {
    // Display the loading indicator
    const loadingIndicator = document.getElementById('loading_shef');
    loadingIndicator.style.display = 'block';

    let setCategory = "Netmiss-Forecast";

    let setBaseUrl = null;
    if (cda === "internal") {
        setBaseUrl = `https://wm.${office.toLowerCase()}.ds.usace.army.mil:8243/${office.toLowerCase()}-data/`;
        console.log("setBaseUrl: ", setBaseUrl);
    } else if (cda === "public") {
        setBaseUrl = `https://cwms-data.usace.army.mil/cwms-data/`;
        console.log("setBaseUrl: ", setBaseUrl);
    }

    const apiUrl = setBaseUrl + `location/group?office=${office}&include-assigned=false&location-category-like=${setCategory}`;
    // console.log("apiUrl: ", apiUrl);

    const netmissTsidMap = new Map();
    const metadataMap = new Map();

    const metadataPromises = [];
    const netmissTsidPromises = [];

    // Get current date and time
    const currentDateTime = new Date();
    // console.log('currentDateTime:', currentDateTime);

    // Subtract thirty hours from current date and time
    const currentDateTimeMinus30Hours = subtractHoursFromDate(currentDateTime, 23);
    // console.log('currentDateTimeMinus30Hours :', currentDateTimeMinus30Hours);

    // Subtract thirty hours from current date and time
    const currentDateTimeMinus00Hours = subtractHoursFromDate(currentDateTime, 24);
    // console.log('currentDateTimeMinus30Hours :', currentDateTimeMinus30Hours);

    const currentDateTimePlus168Hours = addHoursFromDate(currentDateTime, 190);
    // const currentDateTimePlus168Hours = subtractHoursFromDate(currentDateTime, 23);
    // console.log('currentDateTimeMinus30Hours :', currentDateTimeMinus30Hours);

    fetch(apiUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(data => {
            if (!Array.isArray(data) || data.length === 0) {
                console.warn('No data available from the initial fetch.');
                return;
            }

            const targetCategory = { "office-id": office, "id": setCategory };
            const filteredArray = filterByLocationCategory(data, targetCategory);
            const basins = filteredArray.map(item => item.id);
            if (basins.length === 0) {
                console.warn('No basins found for the given setCategory.');
                return;
            }

            const apiPromises = [];
            const combinedData = [];

            basins.forEach(basin => {
                const basinApiUrl = setBaseUrl + `location/group/${basin}?office=${office}&category-id=${setCategory}`;

                apiPromises.push(
                    fetch(basinApiUrl)
                        .then(response => {
                            if (!response.ok) {
                                throw new Error(`Network response was not ok for basin ${basin}: ${response.statusText}`);
                            }
                            return response.json();
                        })
                        .then(basinData => {
                            // console.log('basinData:', basinData);

                            if (!basinData) {
                                console.log(`No data for basin: ${basin}`);
                                return;
                            }

                            basinData[`assigned-locations`] = basinData[`assigned-locations`].filter(location => location.attribute <= 900);
                            basinData[`assigned-locations`].sort((a, b) => a.attribute - b.attribute);
                            combinedData.push(basinData);

                            if (basinData['assigned-locations']) {
                                basinData['assigned-locations'].forEach(loc => {

                                    let netmissTsidApiUrl = setBaseUrl + `timeseries/group/Netmiss-Comparison?office=${office}&category-id=${loc['location-id']}`;
                                    if (netmissTsidApiUrl) {
                                        netmissTsidPromises.push(
                                            fetch(netmissTsidApiUrl)
                                                .then(response => {
                                                    if (response.status === 404) {
                                                        return null; // Skip processing if no data is found
                                                    }
                                                    if (!response.ok) {
                                                        throw new Error(`Network response was not ok: ${response.statusText}`);
                                                    }
                                                    return response.json();
                                                })
                                                .then(netmissTsidData => {
                                                    // console.log('netmissTsidData:', netmissTsidData);

                                                    // Extract the dynamic part from time-series-category
                                                    let dynamicId = netmissTsidData['time-series-category']['id'];

                                                    // Create the new timeseries-id dynamically
                                                    let newTimeseriesId = `${dynamicId}.Stage.Inst.~1Day.0.netmiss-fcst`;

                                                    // New object to append
                                                    let newAssignedTimeSeries = {
                                                        "office-id": "MVS",
                                                        "timeseries-id": newTimeseriesId, // Use dynamic timeseries-id
                                                        "ts-code": null,
                                                        "attribute": 2
                                                    };

                                                    // Append the new object to assigned-time-series
                                                    netmissTsidData['assigned-time-series'].push(newAssignedTimeSeries);
                                                    // console.log("netmissTsidData: ", netmissTsidData);

                                                    if (netmissTsidData) {
                                                        netmissTsidMap.set(loc['location-id'], netmissTsidData);
                                                    }
                                                })
                                                .catch(error => {
                                                    console.error(`Problem with the fetch operation for stage TSID data at ${netmissTsidApiUrl}:`, error);
                                                })
                                        );
                                    }

                                    if ("metadata" === "metadata") {
                                        // Construct the URL for the location metadata request
                                        let locApiUrl = setBaseUrl + `locations/${loc['location-id']}?office=${office}`;
                                        if (locApiUrl) {
                                            // Push the fetch promise to the metadataPromises array
                                            metadataPromises.push(
                                                fetch(locApiUrl)
                                                    .then(response => {
                                                        if (response.status === 404) {
                                                            console.warn(`Location metadata not found for location: ${loc['location-id']}`);
                                                            return null; // Skip processing if no metadata is found
                                                        }
                                                        if (!response.ok) {
                                                            throw new Error(`Network response was not ok: ${response.statusText}`);
                                                        }
                                                        return response.json();
                                                    })
                                                    .then(locData => {
                                                        if (locData) {
                                                            metadataMap.set(loc['location-id'], locData);
                                                        }
                                                    })
                                                    .catch(error => {
                                                        console.error(`Problem with the fetch operation for location ${loc['location-id']}:`, error);
                                                    })
                                            );
                                        }
                                    }
                                });
                            }
                        })
                        .catch(error => {
                            console.error(`Problem with the fetch operation for basin ${basin}:`, error);
                        })
                );
            });

            Promise.all(apiPromises)
                .then(() => Promise.all(netmissTsidPromises))
                .then(() => {
                    combinedData.forEach(basinData => {
                        if (basinData['assigned-locations']) {
                            basinData['assigned-locations'].forEach(loc => {
                                const netmissTsidMapData = netmissTsidMap.get(loc['location-id']);
                                // console.log('netmissTsidMapData:', netmissTsidMapData);

                                reorderByAttribute(netmissTsidMapData);
                                if (netmissTsidMapData) {
                                    loc['tsid-netmiss'] = netmissTsidMapData;
                                }

                                const metadataMapData = metadataMap.get(loc['location-id']);
                                if (metadataMapData) {
                                    loc['metadata'] = metadataMapData;
                                }
                            });
                        }
                    });

                    // console.log('combinedData:', combinedData);

                    // Fetch additional data using stageTsid, netmissTsid, nwsTsid
                    const additionalPromises = [];

                    for (const locData of combinedData[0][`assigned-locations`]) {
                        const stageTsid = locData[`tsid-netmiss`][`assigned-time-series`][0][`timeseries-id`];
                        const netmissTsid = locData[`tsid-netmiss`][`assigned-time-series`][1][`timeseries-id`];
                        const nwsTsid = locData[`tsid-netmiss`][`assigned-time-series`][2][`timeseries-id`];

                        // Example API calls for additional data (customize these URLs)
                        const stageApiUrl = setBaseUrl + `timeseries?name=${stageTsid}&begin=${currentDateTimeMinus30Hours.toISOString()}&end=${currentDateTimeMinus00Hours.toISOString()}&office=${office}`;
                        const netmissApiUrl = setBaseUrl + `timeseries?name=${netmissTsid}&begin=${currentDateTimeMinus00Hours.toISOString()}&end=${currentDateTimePlus168Hours.toISOString()}&office=${office}`;
                        const nwsApiUrl = setBaseUrl + `timeseries?name=${nwsTsid}&begin=${currentDateTimeMinus00Hours.toISOString()}&end=${currentDateTimePlus168Hours.toISOString()}&office=${office}`;

                        // Fetch additional data
                        additionalPromises.push(
                            Promise.all([
                                fetch(stageApiUrl, {
                                    method: 'GET',
                                    headers: {
                                        'Accept': 'application/json;version=2'
                                    }
                                }).then(res => res.json()),
                                fetch(netmissApiUrl, {
                                    method: 'GET',
                                    headers: {
                                        'Accept': 'application/json;version=2'
                                    }
                                }).then(res => res.json()),
                                fetch(nwsApiUrl, {
                                    method: 'GET',
                                    headers: {
                                        'Accept': 'application/json;version=2'
                                    }
                                }).then(res => res.json())
                            ])
                                .then(([stageData, netmissData, nwsData]) => {
                                    // console.log('stageData:', stageData);
                                    // console.log('netmissData:', netmissData);
                                    // console.log('nwsData:', nwsData);

                                    if (stageData.values) {
                                        stageData.values.forEach(entry => {
                                            entry[0] = formatNWSDate(entry[0]);
                                        });
                                    }

                                    if (netmissData.values) {
                                        netmissData.values.forEach(entry => {
                                            entry[0] = formatNWSDate(entry[0]);
                                        });
                                    }

                                    if (nwsData.values) {
                                        nwsData.values.forEach(entry => {
                                            entry[0] = formatNWSDate(entry[0]);
                                        });
                                    }

                                    // Append the fetched data to the locData
                                    locData['stageData'] = stageData;
                                    locData['netmissData'] = netmissData;
                                    locData['nwsData'] = nwsData;

                                    // Execute the functions to find values and create the table
                                    const stageValuesAtPreferredTimes = findValuesAtTimes(stageData);
                                    // console.log('stageValuesAtPreferredTimes:', stageValuesAtPreferredTimes);
                                    const netmissValuesAtPreferredTimes = extract6AMValues(netmissData);
                                    // console.log('netmissValuesAtPreferredTimes:', netmissValuesAtPreferredTimes);
                                    const nwsValuesAtPreferredTimes = extract6AMValues(nwsData);
                                    // console.log('nwsValuesAtPreferredTimes:', nwsValuesAtPreferredTimes);

                                    locData['stageDataPreferredTimes'] = stageValuesAtPreferredTimes;
                                    locData['netmissDataPreferredTimes'] = netmissValuesAtPreferredTimes;
                                    locData['nwsDataPreferredTimes'] = nwsValuesAtPreferredTimes;
                                })
                                .catch(error => {
                                    console.error(`Error fetching additional data for location ${locData['location-id']}:`, error);
                                })
                        );
                    }

                    // Wait for all additional data fetches to complete
                    return Promise.all(additionalPromises);
                })
                .then(() => {
                    console.log('All netmiss check data fetched successfully:', combinedData);

                    // Append the table to the specified container
                    const container = document.getElementById('table_container_shef');
                    const table = createTableForAllLocations(combinedData);
                    container.appendChild(table);

                    loadingIndicator.style.display = 'none';
                })
                .catch(error => {
                    console.error('There was a problem with one or more fetch operations:', error);
                    loadingIndicator.style.display = 'none';
                });
        })
        .catch(error => {
            console.error('There was a problem with the initial fetch operation:', error);
            loadingIndicator.style.display = 'none';
        });

    function filterByLocationCategory(array, setCategory) {
        return array.filter(item =>
            item['location-category'] &&
            item['location-category']['office-id'] === setCategory['office-id'] &&
            item['location-category']['id'] === setCategory['id']
        );
    }

    function subtractHoursFromDate(date, hoursToSubtract) {
        return new Date(date.getTime() - (hoursToSubtract * 60 * 60 * 1000));
    }

    function addHoursFromDate(date, hoursToSubtract) {
        return new Date(date.getTime() + (hoursToSubtract * 60 * 60 * 1000));
    }

    function formatNWSDate(timestamp) {
        const date = new Date(timestamp);
        const mm = String(date.getMonth() + 1).padStart(2, '0'); // Month
        const dd = String(date.getDate()).padStart(2, '0'); // Day
        const yyyy = date.getFullYear(); // Year
        const hh = String(date.getHours()).padStart(2, '0'); // Hours
        const min = String(date.getMinutes()).padStart(2, '0'); // Minutes
        return `${mm}-${dd}-${yyyy} ${hh}:${min}`;
    }

    const reorderByAttribute = (data) => {
        data['assigned-time-series'].sort((a, b) => a.attribute - b.attribute);
    };

    const formatTime = (date) => {
        const pad = (num) => (num < 10 ? '0' + num : num);
        return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };

    const findValuesAtTimes = (data) => {
        const result = [];
        const currentDate = new Date();

        // Create time options for 5 AM, 6 AM, and 7 AM today in Central Standard Time
        const timesToCheck = [
            new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), 6, 0), // 6 AM CST
            new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), 5, 0), // 5 AM CST
            new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), 7, 0)  // 7 AM CST
        ];

        const foundValues = [];

        // Iterate over the values in the provided data
        const values = data.values;

        // Check for each time in the order of preference
        timesToCheck.forEach((time) => {
            // Format the date-time to match the format in the data
            const formattedTime = formatTime(time);

            const entry = values.find(v => v[0] === formattedTime);
            if (entry) {
                foundValues.push({ time: formattedTime, value: entry[1] }); // Store both time and value if found
            } else {
                foundValues.push({ time: formattedTime, value: null }); // Store null if not found
            }
        });

        // Push the result for this data entry
        result.push({
            name: data.name,
            values: foundValues // This will contain the array of { time, value } objects
        });

        return result;
    };

    const extract6AMValues = (data) => {
        // Define the target time (6:00 AM)
        const targetTime = "06:00";

        // Filter data.values to include only entries with 6:00 AM in the timestamp
        const valuesAt6AM = data.values
            .filter(entry => entry[0].includes(targetTime))
            .slice(0, 7) // Limit to the first 7 items
            .map(entry => ({
                date: entry[0],
                value: entry[1],
                qualityCode: entry[2]
            }));

        return {
            name: data.name,
            valuesAt6AM
        };
    };



    function getValidValue(values) {
        // Get the first non-null value from the values array
        const validValue = values.find(valueEntry => valueEntry.value !== null);
        return validValue ? (validValue.value).toFixed(1) : 'N/A';
    }

    function createTableNetmissCheck(data) {
        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const tbody = document.createElement('tbody');

        table.id = 'customers';

        // Create table header
        const headerRow = document.createElement('tr');
        const headers = ['Location', 'Stage', 'Netmiss', 'NWS'];
        headers.forEach(headerText => {
            const th = document.createElement('th');
            th.textContent = headerText;
            // Apply styles
            th.style.backgroundColor = 'darkblue';
            th.style.color = 'white';
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Populate table rows
        data.forEach(entry => {
            entry['assigned-locations'].forEach(location => {
                const row = document.createElement('tr');

                const locationId = location["location-id"];
                const stageValue = getValidValue(location.stageDataPreferredTimes[0].values);
                const netmissValue = getValidValue(location.netmissDataPreferredTimes[0].values);
                const nwsValue = getValidValue(location.nwsDataPreferredTimes[0].values);

                const netmissValueDelta = (stageValue - netmissValue).toFixed(1);
                const nwsValueDelta = (stageValue - nwsValue).toFixed(1);

                // Create a link for stageValue
                const stageLink = document.createElement('a');
                stageLink.href = `https://wm.mvs.ds.usace.army.mil/apps/chart/index.html?office=MVS&cwms_ts_id=${location[`tsid-netmiss`][`assigned-time-series`][0][`timeseries-id`]}&cwms_ts_id_2=${location[`tsid-netmiss`][`assigned-time-series`][1][`timeseries-id`]}&lookforward=4`; // URL with location name
                stageLink.textContent = stageValue; // Displayed text
                stageLink.target = '_blank'; // Opens link in a new tab

                // Set the inner HTML for the row
                row.innerHTML = `
                        <td>${locationId}</td>
                        <td></td>
                        <td>${netmissValue} (${netmissValueDelta})</td>
                        <td>${nwsValue} (${nwsValueDelta})</td>
                    `;

                // Append the link to the second cell (stage column)
                row.cells[1].appendChild(stageLink);

                // Apply styles based on netmissValueDelta
                if (Math.abs(netmissValueDelta) > 0.49) {
                    row.cells[2].style.backgroundColor = "purple";
                    row.cells[2].style.color = "lightgray";
                } else if (netmissValueDelta >= 0.25) {
                    row.cells[2].style.backgroundColor = "pink";
                } else if (netmissValueDelta <= -0.25) {
                    row.cells[2].style.backgroundColor = "DodgerBlue";
                } else {
                    row.cells[2].style.backgroundColor = "MediumSeaGreen";
                }

                // Apply styles based on nwsValueDelta
                if (Math.abs(nwsValueDelta) > 0.49) {
                    row.cells[3].style.backgroundColor = "purple";
                    row.cells[3].style.color = "lightgray";
                } else if (nwsValueDelta >= 0.25) {
                    row.cells[3].style.backgroundColor = "pink";
                } else if (nwsValueDelta <= -0.25) {
                    row.cells[3].style.backgroundColor = "DodgerBlue";
                } else {
                    row.cells[3].style.backgroundColor = "MediumSeaGreen";
                }

                tbody.appendChild(row);
            });
        });

        table.appendChild(tbody);

        // Set widths for columns
        const columnWidths = ['40%', '20%', '20%', '20%'];

        // Set the width for header cells
        Array.from(table.getElementsByTagName('th')).forEach((th, index) => {
            th.style.width = columnWidths[index];
        });

        // Set the width for body cells
        Array.from(table.getElementsByTagName('td')).forEach((td, index) => {
            td.style.width = columnWidths[index % columnWidths.length]; // Use modulus to cycle through widths
        });

        return table;
    }

    function createTableForAllLocations(data) {
        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const tbody = document.createElement('tbody');

        table.id = 'all-locations-table';
        table.style.border = '1px solid black';
        table.style.width = '100%';
        table.style.marginBottom = '20px';
        table.style.borderCollapse = 'collapse';

        // Create a single header for all sections
        const headerRow = document.createElement('tr');
        const headers = ['Date/Time', 'Netmiss', 'NWS'];
        headers.forEach(headerText => {
            const th = document.createElement('th');
            th.textContent = headerText;
            th.style.backgroundColor = 'darkblue';
            th.style.color = 'white';
            th.style.border = '1px solid black';
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Populate the table rows for all locations
        data.forEach(entry => {
            entry['assigned-locations'].forEach(location => {
                // Add a row with the location ID as a section header
                const locationRow = document.createElement('tr');
                const locationCell = document.createElement('td');
                locationCell.textContent = `${location['location-id']}`;
                locationCell.colSpan = 3; // Span across all columns
                locationCell.style.backgroundColor = 'lightgray';
                locationCell.style.fontWeight = 'bold';
                locationCell.style.textAlign = 'center';
                locationCell.style.border = '1px solid black';
                locationRow.appendChild(locationCell);
                tbody.appendChild(locationRow);

                // Get data for the location
                const netmissData = location.netmissDataPreferredTimes?.valuesAt6AM || [];
                const nwsData = location.nwsDataPreferredTimes?.valuesAt6AM || [];

                // Add rows for the data
                const rowCount = Math.max(netmissData.length, nwsData.length); // Handle cases where data arrays have different lengths
                for (let i = 0; i < rowCount; i++) {
                    const row = document.createElement('tr');

                    // Access the date and value from the netmissData and nwsData arrays directly
                    const dateTime = netmissData[i]?.date || 'N/A'; // Default to 'N/A' if null/undefined
                    const netmissValue = netmissData[i]?.value != null ? netmissData[i].value.toFixed(2) : 'N/A'; // Handle null/undefined gracefully
                    const nwsValue = nwsData[i]?.value != null ? nwsData[i].value.toFixed(2) : 'N/A'; // Handle null/undefined gracefully

                    row.innerHTML = `
                        <td style="border: 1px solid black; text-align: center;">${dateTime}</td>
                        <td style="border: 1px solid black; text-align: center;">${netmissValue}</td>
                        <td style="border: 1px solid black; text-align: center;">${nwsValue}</td>
                    `;
                    tbody.appendChild(row);
                }
            });
        });

        table.appendChild(tbody);

        return table;
    }

});