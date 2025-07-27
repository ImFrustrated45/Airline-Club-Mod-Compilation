// ==UserScript==
// @name         Cost per PAX COMBINED WITH Airline Club Distance Circles
// @namespace    http://tampermonkey.net/
// @version      1.2.6.2
// @description  2 scripts combined together
// @author       Author: Alrianne, Claude AI, with a gentle nudge by Saputnik / Plupi / CrownAirwyas. Complied by: Foodie airlines
// @match        https://*.airline-club.com/*
// @icon         https://www.google.com/s2/favicons?domain=airline-club.com
// @grant        none
// @updateURL    https://github.com/ImFrustrated45/Airline-Club-Mod-Compilation/blob/main/Cost_per_pax.user.js
// @downloadURL  https://github.com/ImFrustrated45/Airline-Club-Mod-Compilation/blob/main/Cost_per_pax.user.js
// ==/UserScript==
var MIN_PLANES_TO_HIGHLIGHT = 500; // Changes which planes get the gold shadow/highlight on plane purchase table (not affected by filters in table header)

var REMOVE_MOVING_BACKGROUND = true; // perf enhancement, less noisy -- !!! IF YOU ARE A PATREON MEMBER DISABLE THIS FOR YOUR CUSTOM BACKGROUNDS !!!
var SOLID_BACKGROUND_COLOR = `rgb(83, 85, 113)`; // only matters if REMOVE_MOVING_BACKGROUND is true

// Default filter values for plane purchase table header:
var DEFAULT_MIN_PLANES_IN_CIRCULATION_FILTER = 450; // Changes default minimum number of planes in circulation to remove from plane purchase table
var DEFAULT_MIN_FLIGHT_RANGE_FILTER = 1000;
var DEFAULT_RUNWAY_LENGTH_FILTER = 3000;
var DEFAULT_MIN_CAPACITY_FILTER = 0;

var MAIN_PANEL_WIDTH = '62%'; // Percent of screen for all the main (left-side) tables with lists (flight/airplane/etc)
var SIDE_PANEL_WIDTH = '38%'; // Percent of screen for all the right-side details (usually linked with whatever is selected in the main/left panel, e.g. flight details)

// Plugin code starts here and goes to the end...
// NOTE: there's a bit in the lines 800-830 where you can change the way airport and plane names are displayed on the flight list view, but you might want to change some of the column widths (around line 680) to keep the rows on one-line.
// Feel free to leave a comment on the gist if you have any questions or requests: https://gist.github.com/aphix/fdeeefbc4bef1ec580d72639bbc05f2d

function reportAjaxError(jqXHR, textStatus, errorThrown) {
    console.error(JSON.stringify(jqXHR));
    console.error("AJAX error: " + textStatus + ' : ' + errorThrown);
    // throw errorThrown;
}

function _request(url, method = 'GET', data = undefined) {
    return new Promise((resolve, reject) => {
        $.ajax({
            url,
            type: method,
            contentType: 'application/json; charset=utf-8',
            data: data ? JSON.stringify(data) : data,
            dataType: 'json',
            success: resolve,
            error: (...args) => {
                reportAjaxError(...args);
                reject(...args);
            }
        })
    })
}

function getFactorPercent(consumption, subType) {
    return (consumption.capacity[subType] > 0)
        ? parseInt(consumption.soldSeats[subType] / consumption.capacity[subType] * 100)
        : null;
}

function getLoadFactorsFor(consumption) {
    var factor = {};
    for (let key in consumption.capacity) {
        factor[key] = getFactorPercent(consumption, key) || '-';
    }
    return factor;
}

function _seekSubVal(val, ...subKeys) {
    if (subKeys.length === 0) {
        return val;
    }
    return _seekSubVal(val[subKeys[0]], ...subKeys.slice(1));
}

function averageFromSubKey(array, ...subKeys) {
    return array.map(obj => _seekSubVal(obj, ...subKeys)).reduce((sum, val) => sum += (val || 0), 0) / array.length;
}

function _populateDerivedFieldsOnLink(link) {
    link.totalCapacity = link.capacity.economy + link.capacity.business + link.capacity.first
    link.totalCapacityHistory = link.capacityHistory.economy + link.capacityHistory.business + link.capacityHistory.first
    link.totalPassengers = link.passengers.economy + link.passengers.business + link.passengers.first
    link.totalLoadFactor = link.totalCapacityHistory > 0 ? Math.round(link.totalPassengers / link.totalCapacityHistory * 100) : 0
    var assignedModel
    if (link.assignedAirplanes && link.assignedAirplanes.length > 0) {
        assignedModel = link.assignedAirplanes[0].airplane.name
    } else {
        assignedModel = "-"
    }
    link.model = assignedModel //so this can be sorted

    link.profitMarginPercent = link.revenue === 0
        ? 0
    : ((link.profit + link.revenue) / link.revenue) * 100;

    link.profitMargin = link.profitMarginPercent > 100
        ? link.profitMarginPercent - 100
    : (100 - link.profitMarginPercent) * -1;

    link.profitPerPax = link.totalPassengers === 0
        ? 0
    :link.profit / link.totalPassengers;

    link.profitPerFlight = link.profit / link.frequency;
    link.profitPerHour = link.profit / link.duration;
    link.profitPerStaff = link.profit / link.staffInfo.staffBreakdown.total;
}


function getAirportText(city, airportCode) {
	if (city) {
		return city + " (" + airportCode + ")"
	} else {
		return airportCode
	}
}

function plotHistory(linkConsumptions) {
    plotLinkCharts(linkConsumptions)
    $("#linkHistoryDetails").show()
}

function getShortModelName(airplaneName) {
    var sections = airplaneName.trim().split(' ').slice(1);

    return sections
        .map(str => (str.includes('-')
                     || str.length < 4
                     || /^[A-Z0-9\-]+[a-z]{0,4}$/.test(str))
             ? str
             : str[0].toUpperCase())
        .join(' ');
}

function getStyleFromTier(tier) {
    const stylesFromGoodToBad = [
        'color:#29FF66;',
        'color:#5AB874;',
        'color:inherit;',

        'color:#FA8282;',
        //'color:#FF3D3D;',
        //'color:#B30E0E;text-shadow:0px 0px 2px #CCC;',

        'color:#FF6969;',
        'color:#FF3D3D;font-weight: bold;',
        // 'color:#FF3D3D;text-decoration:underline',
    ];


    return stylesFromGoodToBad[tier];
}

function getTierFromPercent(val, min = 0, max = 100) {
    var availableRange = max - min;
    var ranges = [
        .95,
        .80,
        .75,
        .6,
        .5
    ].map(multiplier => (availableRange * multiplier) + min);

    var tier;
    if (val > ranges[0]) {
        return 0;
    } else if (val > ranges[1]) {
        return 1;
    } else if (val > ranges[2]) {
        return 2;
    } else if (val > ranges[3]) {
        return 3;
    } else if (val > ranges[4]) {
        return 4;
    }

    return 5;
}

async function loadCompetitionForLink(airlineId, link) {
    const linkConsumptions = await _request(`airports/${link.fromAirportId}/to/${link.toAirportId}`);

    $("#linkCompetitons .data-row").remove()
    $.each(linkConsumptions, function(index, linkConsumption) {
        var row = $("<div class='table-row data-row'><div style='display: table-cell;'>" + linkConsumption.airlineName
                + "</div><div style='display: table-cell;'>" + toLinkClassValueString(linkConsumption.price, "$")
                + "</div><div style='display: table-cell; text-align: right;'>" + toLinkClassValueString(linkConsumption.capacity)
                + "</div><div style='display: table-cell; text-align: right;'>" + linkConsumption.quality
                + "</div><div style='display: table-cell; text-align: right;'>" + linkConsumption.frequency + "</div></div>")

        if (linkConsumption.airlineId == airlineId) {
            $("#linkCompetitons .table-header").after(row) //self is always on top
        } else {
            $("#linkCompetitons").append(row)
        }

    })

    if ($("#linkCompetitons .data-row").length == 0) {
        $("#linkCompetitons").append("<div class='table-row data-row'><div style='display: table-cell;'>-</div><div style='display: table-cell;'>-</div><div style='display: table-cell;'>-</div><div style='display: table-cell;'>-</div><div style='display: table-cell;'>-</div></div>")
    }

    $("#linkCompetitons").show()

    assignAirlineColors(linkConsumptions, "airlineId")
    plotPie(linkConsumptions, null, $("#linkCompetitionsPie"), "airlineName", "soldSeats")

    return linkConsumptions;
}

function _isFullPax(link, key) {
    return link.passengers[key] === link.capacity[key];
}

function _getPricesFor(link) {
    var linkPrices = {};
    for (var key in link.price) {
        if (key === 'total') continue;

        linkPrices[key] = link.price[key] - 5;
        // linkPrices[key] = link.price[key] - (_isFullPax(link, key) ? 0 : 5);
    }

    return linkPrices;
}

async function _doAutomaticPriceUpdateFor(link) {
    var priceUpdate = {
        fromAirportId: link.fromAirportId,
        toAirportId: link.toAirportId,
        assignedDelegates: 0,
        airplanes: {},
        airlineId: link.assignedAirplanes[0].airplane.ownerId,
        price: _getPricesFor(link),
        model: link.assignedAirplanes[0].airplane.modelId,
        rawQuality: link.rawQuality
    }

    for (var p of link.assignedAirplanes) {
        if (!p.frequency) continue;

        priceUpdate.airplanes[p.airplane.id] = p.frequency;
    }

    const updateResult = await _request(`/airlines/${priceUpdate.airlineId}/links`, 'PUT', priceUpdate);

}

//load history
async function loadHistoryForLink(airlineId, linkId, cycleCount, link) {
    const linkHistory = await _request(`airlines/${airlineId}/link-consumptions/${linkId}?cycleCount=${cycleCount}`);

    if (jQuery.isEmptyObject(linkHistory)) {
        $("#linkHistoryPrice").text("-")
        $("#linkHistoryCapacity").text("-")
        $("#linkLoadFactor").text("-")
        $("#linkProfit").text("-")
        $("#linkRevenue").text("-")
        $("#linkFuelCost").text("-")
        $("#linkCrewCost").text("-")
        $("#linkAirportFees").text("-")
        $("#linkDepreciation").text("-")
        $("#linkCompensation").text("-")
        $("#linkLoungeCost").text("-")
        $("#linkServiceSupplies").text("-")
        $("#linkMaintenance").text("-")
        $("#linkOtherCosts").text("-")
        $("#linkDelays").text("-")
        $("#linkCancellations").text("-")

        disableButton($("#linkDetails .button.viewLinkHistory"), "Passenger Map is not yet available for this route - please wait for the simulation (time estimation on top left of the screen).")
        disableButton($("#linkDetails .button.viewLinkComposition"), "Passenger Survey is not yet available for this route - please wait for the simulation (time estimation on top left of the screen).")

        plotHistory(linkHistory);
        return;
    }


    if (!$("#linkAverageLoadFactor").length) {
        $("#linkLoadFactor").parent().after(`<div class="table-row" style="color:#999">
            <div class="label" style="color:#999"><h5>Avg. Load Factor:</h5></div>
            <div class="value" id="linkAverageLoadFactor"></div>
        </div>`)
    }

    if (!$("#linkAverageProfit").length) {
        $("#linkProfit").parent().after(`<div class="table-row" style="color:#999">
            <div class="label" style="color:#999"><h5>Avg. Profit:</h5></div>
            <div class="value" id="linkAverageProfit"></div>
        </div>`)
    }

    //if (!$("#doAutomaticPriceUpdate").length) {
    //    $("#linkLoadFactor").parent().after(`<div class="table-row" style="color:#999">
    //        <div class="button" id="doAutomaticPriceUpdate">Auto Manage</div>
    //    </div>`)
    //}

    const averageLoadFactor = getLoadFactorsFor({
        soldSeats: {
            economy: averageFromSubKey(linkHistory, 'soldSeats', 'economy'),
            business: averageFromSubKey(linkHistory, 'soldSeats', 'business'),
            first: averageFromSubKey(linkHistory, 'soldSeats', 'first'),
        },
        capacity: {
            economy: averageFromSubKey(linkHistory, 'capacity', 'economy'),
            business: averageFromSubKey(linkHistory, 'capacity', 'business'),
            first: averageFromSubKey(linkHistory, 'capacity', 'first'),
        }
    });

    var latestLinkData = linkHistory[0]
    $("#linkHistoryPrice").text(toLinkClassValueString(latestLinkData.price, "$"))
    $("#linkHistoryCapacity").text(toLinkClassValueString(latestLinkData.capacity))

    if (latestLinkData.totalLoadFactor !== 100) {
        let originalLink = link;
        //console.dir(originalLink);
        $("#doAutomaticPriceUpdate").click(() => {
            _doAutomaticPriceUpdateFor(originalLink);
        });

        $("#doAutomaticPriceUpdate").show();
    } else {
        $("#doAutomaticPriceUpdate").hide();
    }

    $("#linkLoadFactor").text(toLinkClassValueString(getLoadFactorsFor(latestLinkData), "", "%"))
    $("#linkAverageLoadFactor").text(toLinkClassValueString(averageLoadFactor, "", "%"))

    const dollarValuesByElementId = {
        linkProfit: latestLinkData.profit,
        linkAverageProfit: Math.round(averageFromSubKey(linkHistory, 'profit')),
        linkRevenue: latestLinkData.revenue,
        linkFuelCost: latestLinkData.fuelCost,
        linkCrewCost: latestLinkData.crewCost,
        linkAirportFees: latestLinkData.airportFees,
        linkDepreciation: latestLinkData.depreciation,
        linkCompensation: latestLinkData.delayCompensation,
        linkLoungeCost: latestLinkData.loungeCost,
        linkServiceSupplies: latestLinkData.inflightCost,
        linkMaintenance: latestLinkData.maintenanceCost,
    };

    for (const elementId in dollarValuesByElementId) {
        $('#'+elementId).text('$' + commaSeparateNumber(dollarValuesByElementId[elementId]));
    }

    if (latestLinkData.minorDelayCount == 0 && latestLinkData.majorDelayCount == 0) {
        $("#linkDelays").removeClass("warning")
        $("#linkDelays").text("-")
    } else {
        $("#linkDelays").addClass("warning")
        $("#linkDelays").text(latestLinkData.minorDelayCount + " minor " + latestLinkData.majorDelayCount + " major")
    }

    if (latestLinkData.cancellationCount == 0) {
        $("#linkCancellations").removeClass("warning")
        $("#linkCancellations").text("-")
    } else {
        $("#linkCancellations").addClass("warning")
        $("#linkCancellations").text(latestLinkData.cancellationCount)
    }
    enableButton($("#linkDetails .button.viewLinkHistory"))
    enableButton($("#linkDetails .button.viewLinkComposition"))

    plotHistory(linkHistory);

    return linkHistory;
}

let lastPlotUnit;
window._getPlotUnit = function _getPlotUnit() {
    let checkedElem = $('#linkDetails fieldset .switch input:checked')[0];

    if (!checkedElem && lastPlotUnit) {
        return lastPlotUnit;
    }

    return lastPlotUnit = window.plotUnitEnum[checkedElem ? $(checkedElem).val().toUpperCase() : 'MONTH']
}

window.loadLink = async function loadLink(airlineId, linkId) {
    const link = await _request(`airlines/${airlineId}/links/${linkId}`)

    $("#linkFromAirport").attr("onclick", "showAirportDetails(" + link.fromAirportId + ")").html(getCountryFlagImg(link.fromCountryCode) + getAirportText(link.fromAirportCity, link.fromAirportCode))
    //$("#linkFromAirportExpectedQuality").attr("onclick", "loadLinkExpectedQuality(" + link.fromAirportId + "," + link.toAirportId + "," + link.fromAirportId + ")")
    $("#linkToAirport").attr("onclick", "showAirportDetails(" + link.toAirportId + ")").html(getCountryFlagImg(link.toCountryCode) + getAirportText(link.toAirportCity, link.toAirportCode))
    //$("#linkToAirportExpectedQuality").attr("onclick", "loadLinkExpectedQuality(" + link.fromAirportId + "," + link.toAirportId + "," + link.toAirportId + ")")
    $("#linkFlightCode").text(link.flightCode)
    if (link.assignedAirplanes && link.assignedAirplanes.length > 0) {
        $('#linkAirplaneModel').text(link.assignedAirplanes[0].airplane.name + "(" + link.assignedAirplanes.length + ")")
    } else {
        $('#linkAirplaneModel').text("-")
    }
    $("#linkCurrentPrice").text(toLinkClassValueString(link.price, "$"))
    $("#linkDistance").text(link.distance + " km (" + link.flightType + ")")
    $("#linkQuality").html(getGradeStarsImgs(Math.round(link.computedQuality / 10)) + link.computedQuality)
    $("#linkCurrentCapacity").text(toLinkClassValueString(link.capacity))
    if (link.future) {
        $("#linkCurrentDetails .future .capacity").text(toLinkClassValueString(link.future.capacity))
        $("#linkCurrentDetails .future").show()
    } else {
        $("#linkCurrentDetails .future").hide()
    }
    $("#linkCurrentDetails").show()

    $("#linkToAirportId").val(link.toAirportId)
    $("#linkFromAirportId").val(link.fromAirportId)

    const plotUnit = _getPlotUnit();

    // const plotUnit = $("#linkDetails #switchMonth").is(':checked')
    //     ? window.plotUnitEnum.MONTH
    //     : $("#linkDetails #switchQuarter").is(':checked')
    //         ? window.plotUnitEnum.QUARTER
    //         : window.plotUnitEnum.YEAR;

    const cycleCount = plotUnit.maxWeek;

    const [
        linkCompetition,
        linkHistory,
    ] = await Promise.all([
        loadCompetitionForLink(airlineId, link),
        loadHistoryForLink(airlineId, linkId, cycleCount, link),
    ])

    return {
        link,
        linkCompetition,
        linkHistory,
    };
}

async function _updateLatestOilPriceInHeader() {
    const oilPrices = await _request('oil-prices');
    const latestPrice = oilPrices.slice(-1)[0].price;

    if (!$('.topBarDetails .latestOilPriceShortCut').length) {
        $('.topBarDetails .delegatesShortcut').after(`
            <span style="margin: 0px 10px; padding: 0 5px"  title="Latest Oil Price" class="latestOilPriceShortCut clickable" onclick="showOilCanvas()">
                <span class="latest-price label" style=""></span>
            </span>
        `);
    }

    const tierForPrice = 5 - getTierFromPercent(latestPrice, 40, 80);

    if (tierForPrice < 2) {
        $('.latestOilPriceShortCut')
            .addClass('glow')
            .addClass('button');
    } else {
        $('.latestOilPriceShortCut')
            .removeClass('glow')
            .removeClass('button');
    }

    $('.topBarDetails .latest-price')
        .text('$'+commaSeparateNumber(latestPrice))
        .attr({style: getStyleFromTier(tierForPrice)});

    setTimeout(() => {
        _updateLatestOilPriceInHeader();
    }, Math.round(Math.max(durationTillNextTick / 2, 30000)));
}

function commaSeparateNumberForLinks(val) {
    const over1k = val > 1000 || val < -1000;
    const isNegative = (val < 0);

    if (val !== 0) {
        const withDecimal = Math.abs(over1k ? val / 1000 : val);
        const remainderTenths = Math.round((withDecimal % 1) * 10) / 10;
        val = Math.floor(withDecimal) + remainderTenths;

        while (/(\d+)(\d{3})/.test(val.toString())) {
            val = val.toString().replace(/(\d+)(\d{3})/, '$1'+','+'$2');
        }
    }

    const valWithSuffix = over1k ? val + 'k' : val;

    return isNegative ? '(' + valWithSuffix + ')' : valWithSuffix;
}

var _pluralize = (val, str) => `${val} ${str}${val === 1 ? '' : 's'}`
var _twoDigit = (val) => padBefore(val, "0", 2)

var totalmillisecPerWeek = 7 * 24 * 60 * 60 * 1000
var refreshInterval = 1500 //every 5 second
var incrementPerInterval = totalmillisecPerWeek / (40 * 60 * 1000) * refreshInterval //by default 40 minutes per week (was 15)
var durationTillNextTick
var hasTickEstimation = false
var refreshIntervalTimer
var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

var _updateIntervalTimeout;


function _refreshTicks() {
    currentTime += incrementPerInterval
    if (hasTickEstimation) {
        durationTillNextTick -= refreshInterval
    }
    var date = new Date(currentTime)
    //$(".currentTime").text("(" + days[date.getDay()] + ") " + padBefore(date.getMonth() + 1, "0", 2) + '/' + padBefore(date.getDate(), "0", 2) +  " " + padBefore(date.getHours(), "0", 2) + ":" +padBefore(date.getMinutes(), "0", 2))

    var _updateTimeTextIfNeeded = () => null;
    if (hasTickEstimation) {
        var minutesLeft = Math.round(durationTillNextTick / 1000 / 60);
        let unit = minutesLeft <= 0 ? 'second' : 'minute';
        let count = unit === 'minute' ? minutesLeft : Math.round(minutesLeft / 60);
        _updateTimeTextIfNeeded = () => $(".nextTickEstimation").text(_pluralize(count, unit));
    }

    requestAnimationFrame(() => {
        $(".currentTime").text(`(${days[date.getDay()]}) ${_twoDigit(date.getMonth() + 1)}/${_twoDigit(date.getDate())} ${_twoDigit(date.getHours())}:${_twoDigit(date.getMinutes())}`)
        _updateTimeTextIfNeeded();
    });

    _updateIntervalTimeout = setTimeout(() => _refreshTicks(), refreshInterval);
}

var _updateTime = window.updateTime = function updateTime(cycle, fraction, cycleDurationEstimation) {
    console.log('internal updateTime');
    console.dir({cycle, fraction, cycleDurationEstimation});

    $(".currentTime").attr("title", "Current Cycle: " + cycle)
    currrentCycle = currrentCycle = cycle
    currentTime = (cycle + fraction) * totalmillisecPerWeek
    if (_updateIntervalTimeout) {
        //cancel old timer
        clearTimeout(_updateIntervalTimeout)
    }

    if (cycleDurationEstimation > 0) { //update incrementPerInterval
        incrementPerInterval = totalmillisecPerWeek / cycleDurationEstimation * refreshInterval
        durationTillNextTick = cycleDurationEstimation * (1 - fraction)
        hasTickEstimation = true
    }

    _refreshTicks();
}

window.onMessage = function onMessage(evt) { //right now the message is just the cycle #, so refresh the panels
    console.log('onMessagehit');
    var json = JSON.parse(evt.data)
    if (json.ping) { //ok
        console.debug("ping : " + json.ping)
        return
    }
    console.log("websocket received message : " + evt.data)

    if (json.messageType == "cycleInfo") { //update time
        window.updateTime(json.cycle, json.fraction, json.cycleDurationEstimation)
        //	} else if (json.messageType == "cycleStart") { //update time
        //		updateTime(json.cycle, 0)
    } else if (json.messageType == "cycleCompleted") {
        if (selectedAirlineId) {
            refreshPanels(selectedAirlineId)
        }
    } else if (json.messageType == "broadcastMessage") {
        queuePrompt("broadcastMessagePopup", json.message)
    } else if (json.messageType == "airlineMessage") {
        queuePrompt("airlineMessagePopup", json.message)
    } else if (json.messageType == "notice") {
        queueNotice(json)
    } else if (json.messageType == "tutorial") {
        queueTutorialByJson(json)
    } else if (json.messageType == "pendingAction") {
        handlePendingActions(json.actions)
    } else {
        console.warn("unknown message type " + evt.data)
    }
}

function launch(){

    window.plotUnitEnum = {
        "WEEK": {
            "value": 4,
            "maxWeek": 28,
            "weeksPerMark": 1,
            "maxMark": 28
        },
        "MONTH": {
            "value": 1,
            "maxWeek": 104,
            "weeksPerMark": 4,
            "maxMark": 28
        },
        "QUARTER": {
            "value": 2,
            "maxWeek": 168,
            "weeksPerMark": 12,
            "maxMark": 28
        },
        "YEAR": {
            "value": 3,
            "maxWeek": 300,
            "weeksPerMark": 52,
            "maxMark": 28
        }
    }

    window.commaSeparateNumberForLinks = commaSeparateNumberForLinks;

    var cachedTotalsById = window.cachedTotalsById = {};
    window.cachedTotalsById = cachedTotalsById;

	window.loadAirplaneModelStats = async function loadAirplaneModelStats(modelInfo, opts = {}) {
	    var url
	    var favoriteIcon = $("#airplaneModelDetail .favorite")
	    var model = loadedModelsById[modelInfo.id]
	    if (activeAirline) {
	        url = "airlines/" + activeAirline.id + "/airplanes/model/" + model.id + "/stats",
	        favoriteIcon.show()
	    } else {
	        url = "airplane-models/" + model.id + "/stats"
	        favoriteIcon.hide()
	    }

        if (opts && opts.totalOnly && model.in_use  && model.in_use !== -1) {
        	return;
        }

        if (opts && opts.totalOnly && cachedTotalsById[model.id]) {
        	model.in_use = cachedTotalsById[model.id];
        	return;
        }

        const stats = await _request(url);

        if (opts && opts.totalOnly) {
    		cachedTotalsById[model.id] = model.in_use = stats.total;
        	return;
        }

    	updateTopOperatorsTable(stats)
    	$('#airplaneCanvas .total').text(stats.total)

    	cachedTotalsById[model.id] = model.in_use = stats.total;

    	if (stats.favorite === undefined) {
    		return;
    	}

	    favoriteIcon.off() //remove all listeners

        if (stats.favorite.rejection) {
            $("#setFavoriteModal").data("rejection", stats.favorite.rejection)
        } else {
            $("#setFavoriteModal").removeData("rejection")
        }

        if (modelInfo.isFavorite) {
            favoriteIcon.attr("src", "assets/images/icons/heart.png")
            $("#setFavoriteModal").data("rejection", "This is already the Favorite")
        } else {
            favoriteIcon.attr("src", "assets/images/icons/heart-empty.png")
        }

        $("#setFavoriteModal").data("model", model)
	}

    window.updateCustomLinkTableHeader = function updateCustomLinkTableHeader() {
        if ($('#linksTableSortHeader').children().length === 16) {
            return;
        }

        $('#linksCanvas .mainPanel').css({width: MAIN_PANEL_WIDTH});
        $('#linksCanvas .sidePanel').css({width: SIDE_PANEL_WIDTH});

        $('#canvas .mainPanel').css({width: MAIN_PANEL_WIDTH});
        $('#canvas .sidePanel').css({width: SIDE_PANEL_WIDTH});

        const widths = [
            8,
            8,
            8,
            6,
            11,
            4,
            5,
            5,
            8,
            7,
            5,
            5,
            6,
            6,
            6,
            2, //tiers, 1st
        ];

        const sum = widths.reduce((acc, val) => acc + val, 0);
        if (sum !== 100) {
            console.warn(`Column widths to not add up to 100: ${sum} (${widths.join(',')}) -- ${sum < 100 ? 'Remaining' : 'Over by'}: ${sum < 100 ? 100 - sum : sum - 100}%`)
        }

        $('#linksTableSortHeader').html(`
            <div class="cell clickable" style="width: ${widths[15]}%" data-sort-property="tiersRank" data-sort-order="descending" onclick="toggleLinksTableSortOrder($(this))" title="Aggregated Rank">#</div>
            <div class="cell clickable" style="width: ${widths[0]}%" data-sort-property="fromAirportCode" data-sort-order="descending" onclick="toggleLinksTableSortOrder($(this))">From</div>
            <div class="cell clickable" style="width: 0%" data-sort-property="lastUpdate" data-sort-order="ascending" id="hiddenLinkSortBy"></div> <!--hidden column for last update (cannot be first otherwise the left round corner would not work -->
            <div class="cell clickable" style="width: ${widths[1]}%" data-sort-property="toAirportCode" data-sort-order="descending" onclick="toggleLinksTableSortOrder($(this))">To</div>
            <div class="cell clickable" style="width: ${widths[2]}%" data-sort-property="model" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))">Model</div>
            <div class="cell clickable" style="width: ${widths[3]}%" align="right" data-sort-property="distance" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))">Dist.</div>
            <div class="cell clickable" style="width: ${widths[4]}%" align="right" data-sort-property="totalCapacity" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))">Capacity (Freq.)</div>
            <div class="cell clickable" style="width: ${widths[5]}%" align="right" data-sort-property="totalPassengers" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))">Pax</div>
            <div class="cell clickable" style="width: ${widths[6]}%" align="right" data-sort-property="totalLoadFactor" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))" title="Load Factor">LF</div>
            <div class="cell clickable" style="width: ${widths[7]}%" align="right" data-sort-property="satisfaction" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))" title="Satisfaction Factor">SF</div>
            <div class="cell clickable" style="width: ${widths[8]}%" align="right" data-sort-property="revenue" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))">Revenue</div>
            <div class="cell clickable" style="width: ${widths[9]}%" align="right" data-sort-property="profit" data-sort-order="descending" onclick="toggleLinksTableSortOrder($(this))">Profit</div>
            <div class="cell clickable" style="width: ${widths[10]}%" align="right" data-sort-property="profitMargin" title="Profit Margin" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))">Gain</div>
            <div class="cell clickable" style="width: ${widths[11]}%" align="right" data-sort-property="profitPerPax" title="Profit PerPax" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))">$/🧍</div>
            <div class="cell clickable" style="width: ${widths[12]}%" align="right" data-sort-property="profitPerFlight" title="Profit Per Flight" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))">$/✈</div>
            <div class="cell clickable" style="width: ${widths[13]}%" align="right" data-sort-property="profitPerHour" title="Profit Per Hour" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))">$/⏲</div>
            <div class="cell clickable" style="width: ${widths[14]}%" align="right" data-sort-property="profitPerStaff" title="Profit Per Staff" data-sort-order="ascending" onclick="toggleLinksTableSortOrder($(this))">$/👨‍💼</div>
        `);

        $('#linksTable .table-header').html(`
            <div class="cell" style="width: ${widths[15]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[0]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[1]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[2]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[3]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[4]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[5]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[6]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[7]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[8]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[9]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[10]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[11]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[12]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[13]}%; border-bottom: none;"></div>
            <div class="cell" style="width: ${widths[14]}%; border-bottom: none;"></div>
        `);
    }

    window.loadLinksTable = async function loadLinksTable() {
        const links = await _request(`airlines/${activeAirline.id}/links-details`);

        await Promise.all(links.map(async link => {
            link.staffInfo = await _getOvertimeAndStaffInfoForLink(link);
        }))

        _updateChartOptionsIfNeeded();
        updateCustomLinkTableHeader();
        updateLoadedLinks(links);

        $.each(links, (key, link) => _populateDerivedFieldsOnLink(link));

        var selectedSortHeader = $('#linksTableSortHeader .cell.selected')
        updateLinksTable(selectedSortHeader.data('sort-property'), selectedSortHeader.data('sort-order'))
    }

    var colorKeyMaps = {};
    window.updateLinksTable = function updateLinksTable(sortProperty, sortOrder) {
        var linksTable = $("#linksCanvas #linksTable")
        linksTable.children("div.table-row").remove()

        loadedLinks = sortPreserveOrder(loadedLinks, sortProperty, sortOrder == "ascending")

        function getKeyedStyleFromLink(link, keyName, ...args) {
            if (!colorKeyMaps[keyName]) {
                colorKeyMaps[keyName] = new WeakMap();
            } else if (colorKeyMaps[keyName].has(link)) {
                return colorKeyMaps[keyName].get(link);
            }

            var data = loadedLinks.map(l => l[keyName]);

            var avg = data.reduce((sum, acc) => sum += acc, 0) / loadedLinks.length;
            var max = Math.max(...data);
            var min = Math.max(Math.min(...data), 0);

            var tier = getTierFromPercent(link[keyName], args[0] !== undefined ? args[0] : min, args[1] || (avg * .618));
            if (!link.tiers) {
                link.tiers = {};
            }

            link.tiers[keyName] = tier;

            var colorResult = getStyleFromTier(tier);

            colorKeyMaps[keyName].set(link, colorResult);

            return colorResult;
        }

        $.each(loadedLinks, function(index, link) {
            var row = $("<div class='table-row clickable' onclick='selectLinkFromTable($(this), " + link.id + ")'></div>")

            var srcAirportFull = getAirportText(link.fromAirportCity, link.fromAirportCode);
            var destAirportFull = getAirportText(link.toAirportCity, link.toAirportCode);

            //                 COMMENT one set or the other to test both:
            // Truncated
            //
            row.append("<div class='cell' title='"+ srcAirportFull +"'>" + getCountryFlagImg(link.fromCountryCode) + ' ' + srcAirportFull.slice(-4, -1) + "</div>")
            row.append("<div class='cell' title='"+ destAirportFull +"'>" + getCountryFlagImg(link.toCountryCode) + ' ' + destAirportFull.slice(-4, -1) + "</div>")
            //
            //    OR
            //
            // Original/Full airport names
            //
            //row.append("<div class='cell'>" + getCountryFlagImg(link.fromCountryCode) + ' ' + srcAirportFull + "</div>")
            //row.append("<div class='cell'>" + getCountryFlagImg(link.toCountryCode) + ' ' + destAirportFull + "</div>")
            //
            //    OR
            //
            // Reversed, IATA/ICAO first w/ truncation
            //
            //row.append("<div class='cell' style='text-overflow: ellipsis;overflow: hidden;white-space: pre;' title='"+ srcAirportFull +"'>" + getCountryFlagImg(link.fromCountryCode) + ' ' + srcAirportFull.slice(-4, -1) + ' | ' + srcAirportFull.slice(0, -5) + "</div>")
            //row.append("<div class='cell' style='text-overflow: ellipsis;overflow: hidden;white-space: pre;' title='"+ destAirportFull +"'>" + getCountryFlagImg(link.toCountryCode) + ' ' + destAirportFull.slice(-4, -1) + ' | ' + destAirportFull.slice(0, -5) + "</div>")
            //

            row.append("<div class='cell' style='text-overflow: ellipsis;overflow: hidden;white-space: pre;'>" + getShortModelName(link.model) + "</div>")
            row.append("<div class='cell' align='right'>" + link.distance + "km</div>")
            row.append("<div class='cell' align='right'>" + link.totalCapacity + " (" + link.frequency + ")</div>")
            row.append("<div class='cell' align='right'>" + link.totalPassengers + "</div>")

            // row.append("<div style='"+getKeyedStyleFromLink(link, 'totalLoadFactor', 0, 100)+"' class='cell' align='right'>" + link.totalLoadFactor + '%' + "</div>")
            const lfBreakdown = {
                economy: link.passengers.economy / link.capacity.economy,
                business: link.passengers.business / link.capacity.business,
                first: link.passengers.first / link.capacity.first,
            };

            lfBreakdownText = link.totalLoadFactor === 100
                ? '100'
                : [lfBreakdown.economy, lfBreakdown.business, lfBreakdown.first].map(v => v ? Math.floor(100 * v) : '-').join('/').replace(/(\/\-)+$/g, '')

            row.append("<div style='"+getKeyedStyleFromLink(link, 'totalLoadFactor', 0, 100)+"' class='cell' align='right'>" + lfBreakdownText + '%' + "</div>")

            row.append("<div style='"+getKeyedStyleFromLink(link, 'satisfaction', 0, 1)+"' class='cell' align='right'>" + Math.round(link.satisfaction * 100) + '%' + "</div>")
            row.append("<div style='"+getKeyedStyleFromLink(link, 'revenue')+"'  class='cell' align='right' title='$"+ commaSeparateNumber(link.revenue) +"'>" + '$' + commaSeparateNumberForLinks(link.revenue) + "</div>")
            row.append("<div style='"+getKeyedStyleFromLink(link, 'profit')+"'  class='cell' align='right' title='$"+ commaSeparateNumber(link.profit) +"'>" + '$' + commaSeparateNumberForLinks(link.profit) +"</div>")

            //row.append("<div style='color:"+textColor+";' class='cell' align='right'>" + (link.profitMargin > 0 ? '+' : '') + Math.round(link.profitMargin) + "%</div>")
            row.append("<div style='"+getKeyedStyleFromLink(link, 'profitMarginPercent', 0, 136.5)+"' class='cell' align='right'>" + (link.profitMargin > 0 ? '+' : '') + Math.round(link.profitMargin) + "%</div>")

            row.append("<div style='"+getKeyedStyleFromLink(link, 'profitPerPax')+"' class='cell' align='right' title='$"+ commaSeparateNumber(link.profitPerPax) +"'>" + '$' + commaSeparateNumberForLinks(link.profitPerPax) + "</div>")
            row.append("<div style='"+getKeyedStyleFromLink(link, 'profitPerFlight')+"' class='cell' align='right' title='$"+ commaSeparateNumber(link.profitPerFlight) +"'>" + '$' + commaSeparateNumberForLinks(link.profitPerFlight) + "</div>")
            row.append("<div style='"+getKeyedStyleFromLink(link, 'profitPerHour')+"' class='cell' align='right' title='$"+ commaSeparateNumber(link.profitPerHour) +"'>" + '$' + commaSeparateNumberForLinks(link.profitPerHour) + "</div>")
            row.append("<div style='"+getKeyedStyleFromLink(link, 'profitPerStaff')+"' class='cell' align='right' title='$"+ commaSeparateNumber(link.profitPerStaff) +"'>" + '$' + commaSeparateNumberForLinks(link.profitPerStaff) + "</div>")

            if (selectedLink == link.id) {
                row.addClass("selected")
            }

            const tiersRank = link.tiersRank = Object.keys(link.tiers).reduce((sum, key) => sum + link.tiers[key] + (key === 'profit' && link.tiers[key] === 0 ? -1 : 0), 0);

            row.prepend("<div class='cell'>" + link.tiersRank + "</div>")

            if (tiersRank < 2) {
                row.css({'text-shadow': '0 0 3px gold'});
            }

            if (tiersRank > 27) {
                row.css({'text-shadow': '0 0 3px red'});
            }

            linksTable.append(row)
        });
    }

    window.refreshLinkDetails = async function refreshLinkDetails(linkId) {
        const airlineId = activeAirline.id

        $("#linkCompetitons .data-row").remove()
        $("#actionLinkId").val(linkId)

        // load link
        const linkDetailsPromise = loadLink(airlineId, linkId); // not awaiting yet so we can kickoff the panel open animation while loading

        setActiveDiv($("#linkDetails"))
        hideActiveDiv($("#extendedPanel #airplaneModelDetails"))
        $('#sidePanel').fadeIn(200);

        const { link, linkCompetition, linkHistory } = await linkDetailsPromise; // link details loaded if needed for something later

        console.log('HERE');
        console.log('HERE');
        console.dir({link, linkCompetition, linkHistory});
    }

    async function _getOvertimeAndStaffInfoForLink(link) {
        const airplaneFrequencies = {};

        for (const {airplane, frequency} of link.assignedAirplanes) {
            airplaneFrequencies[airplane.id] = frequency;
        }

        // See "getLinkStaffingInfo" in main code to understand where this comes from:
        const result = await _request(`airlines/${activeAirline.id}/link-overtime-compensation`, 'POST', {
            fromAirportId : link.fromAirportId,
            toAirportId : link.toAirportId,
            airplanes : airplaneFrequencies,
            airlineId: activeAirline.id,
            price: {
                economy: link.price.economy,
                business: link.price.business,
                first: link.price.first,
            },
            model: link.modelId,
            rawQuality: link.rawQuality * 20,
            assignedDelegates: 0,
        })

        return result;
    }

    function _updateChartOptionsIfNeeded() {
        if ($('#linkDetails fieldset .switch #switchYear').length === 1) {
            return
        }

        $('#linkDetails fieldset .switch').parent().html(`
            <div class="switch" style="float: right; width: 160px;margin-right: 16px;">
                <input type="radio" class="switch-input" name="view" value="week" id="switchWeek" checked="">
                <label for="switchWeek" class="switch-label switch-label-off">Week</label>
                <input type="radio" class="switch-input" name="view" value="month" id="switchMonth">
                <label for="switchMonth" class="switch-label switch-label-on">Month</label>
                <input type="radio" class="switch-input" name="view" value="quarter" id="switchQuarter">
                <label for="switchQuarter" class="switch-label switch-label-on">Qtr</label>
                <input type="radio" class="switch-input" name="view" value="year" id="switchYear">
                <label for="switchYear" class="switch-label switch-label-on">Year</label>
                <span class="switch-selection"></span>
            </div>`);

        $('#linkDetails fieldset').attr('onchange','refreshLinkCharts($(this))')

         $(`<style>
        /* Added by BetterAirlineClub plugin */
        .switch-input#switchQuarter:checked + .switch-label-on ~ .switch-selection { left: 80px; }
        .switch-input#switchYear:checked + .switch-label-on ~ .switch-selection { left: 120px; }
        </style>`).appendTo('head');
    }


    window.refreshLinkCharts = async function refreshLinkCharts(parentEl) {
        var _checkedElem = $('#linkDetails fieldset .switch input:checked')[0];

        $('#linkDetails fieldset .switch input').each((index, childElem) => {
            const same = childElem === _checkedElem;
            $(childElem).attr('checked', same);
        })

        window.plotUnit = plotUnit = plotUnitEnum[$(_checkedElem).val().toUpperCase() || 'MONTH'];

        var cycleCount = plotUnit.maxWeek
        const actionLinkId = $("#actionLinkId").val();
        const linkConsumptions = await _request(`airlines/${activeAirline.id}/link-consumptions/${actionLinkId}?cycleCount=${cycleCount}`);

        plotLinkCharts(linkConsumptions, plotUnit)
        $("#linkHistoryDetails").show();
    }

    window.plotLinkCharts = function plotLinkCharts(linkConsumptions, plotUnit = _getPlotUnit()) {
        plotLinkProfit(linkConsumptions, $("#linkProfitChart"), plotUnit)
        plotLinkConsumption(linkConsumptions, $("#linkRidershipChart"), $("#linkRevenueChart"), $("#linkPriceChart"), plotUnit)
    }

    window.plotLinkConsumption = function plotLinkConsumption(linkConsumptions, ridershipContainer, revenueContainer, priceContainer, plotUnit) {
        ridershipContainer.children(':FusionCharts').each(function(i) { $(this)[0].dispose() });
        revenueContainer.children(':FusionCharts').each(function(i) { $(this)[0].dispose() });
        priceContainer.children(':FusionCharts').each(function(i) { $(this)[0].dispose() });

        var emptySeatsData = []
        var cancelledSeatsData = []
        var soldSeatsData = {
            economy : [],
            business : [],
            first : [],
        };

        var revenueByClass = {
            economy : [],
            business : [],
            first : [],
        };

        var priceByClass = {
            economy : [],
            business : [],
            first : [],
        };

        var category = []

        if (plotUnit === undefined) {
            plotUnit = plotUnitEnum.MONTH
        }

        var maxWeek = plotUnit.maxWeek
        var weeksPerMark = plotUnit.weeksPerMark
        var xLabel
        switch (plotUnit.value) {
          case plotUnitEnum.MONTH.value:
            xLabel = 'Month'
            break;
          case plotUnitEnum.QUARTER.value:
            xLabel = 'Quarter'
            break;
          case plotUnitEnum.YEAR.value:
            xLabel = 'Year'
            break;
          case plotUnitEnum.WEEK.value:
            xLabel = 'Week'
            break;
        }


        if (!jQuery.isEmptyObject(linkConsumptions)) {
            linkConsumptions = $(linkConsumptions).toArray().slice(0, maxWeek)
            var hasCapacity = {} //check if there's any capacity for this link class at all
            hasCapacity.economy = $.grep(linkConsumptions, (entry) => entry.capacity.economy > 0).length !== 0;
            hasCapacity.business = $.grep(linkConsumptions, (entry) => entry.capacity.business > 0).length !== 0;
            hasCapacity.first = $.grep(linkConsumptions, (entry) => entry.capacity.first > 0).length !== 0;

            $.each(linkConsumptions.reverse(), function(key, linkConsumption) {
                var capacity = linkConsumption.capacity.economy + linkConsumption.capacity.business + linkConsumption.capacity.first
                var soldSeats = linkConsumption.soldSeats.economy + linkConsumption.soldSeats.business + linkConsumption.soldSeats.first
                var cancelledSeats = linkConsumption.cancelledSeats.economy + linkConsumption.cancelledSeats.business + linkConsumption.cancelledSeats.first
                emptySeatsData.push({ value : capacity - soldSeats - cancelledSeats  })
                cancelledSeatsData.push({ value : cancelledSeats  })

                soldSeatsData.economy.push({ value : linkConsumption.soldSeats.economy })
                soldSeatsData.business.push({ value : linkConsumption.soldSeats.business })
                soldSeatsData.first.push({ value : linkConsumption.soldSeats.first })

                revenueByClass.economy.push({ value : linkConsumption.price.economy * linkConsumption.soldSeats.economy })
                revenueByClass.business.push({ value : linkConsumption.price.business * linkConsumption.soldSeats.business })
                revenueByClass.first.push({ value : linkConsumption.price.first * linkConsumption.soldSeats.first })

                if (hasCapacity.economy) {
                    priceByClass.economy.push({ value : linkConsumption.price.economy })
                }
                if (hasCapacity.business) {
                    priceByClass.business.push({ value : linkConsumption.price.business })
                }
                if (hasCapacity.first) {
                    priceByClass.first.push({ value : linkConsumption.price.first })
                }

                var mark = Math.floor(linkConsumption.cycle / weeksPerMark)
                //var week = linkConsumption.cycle % 4 + 1
                category.push({ label : mark.toString()})
            })
        }

        var chartConfig = {
            xAxisname: xLabel,
            YAxisName: "Seats Consumption",
            //sYAxisName: "Load Factor %",
            sNumberSuffix: "%",
            sYAxisMaxValue: "100",
            transposeAxis: "1",
            useroundedges: "1",
            animation: "0",
            showBorder: "0",
            toolTipBorderRadius: "2",
            toolTipPadding: "5",
            plotBorderAlpha: "10",
            usePlotGradientColor: "0",
            paletteColors: "#007849,#0375b4,#ffce00,#D46A6A,#bbbbbb",
            bgAlpha: "0",
            showValues: "0",
            canvasPadding: "0",
            labelDisplay: "wrap",
            labelStep: weeksPerMark
        }

        checkDarkTheme(chartConfig, true)

        var ridershipChart = ridershipContainer.insertFusionCharts({
            type: 'stackedarea2d',
            width: '100%',
            height: '100%',
            dataFormat: 'json',
            containerBackgroundOpacity: '0',
            dataSource: {
                "chart": chartConfig,
                "categories": [{
                    "category": category
                }],
                "dataset": [{
                    seriesName: "Sold Seats (Economy)",
                    data: soldSeatsData.economy
                }, {
                    seriesName: "Sold Seats (Business)",
                    data: soldSeatsData.business
                }, {
                    seriesName: "Sold Seats (First)",
                    data: soldSeatsData.first
                }, {
                    seriesName: "Cancelled Seats",
                    data: cancelledSeatsData
                }, {
                    seriesName: "Empty Seats",
                    data: emptySeatsData
                }
                //, {"seriesName": "Load Factor", "renderAs" : "line", "parentYAxis": "S", "data" : loadFactorData}
                ]
            }
        })

        chartConfig = {
            xAxisname: xLabel,
            YAxisName: "Revenue",
            //sYAxisName: "Load Factor %",
            sYAxisMaxValue: "100",
            transposeAxis:"1",
            useroundedges: "1",
            numberPrefix: "$",
            animation: "0",
            showBorder: "0",
            toolTipBorderRadius: "2",
            toolTipPadding: "5",
            plotBorderAlpha: "10",
            usePlotGradientColor: "0",
            paletteColors: "#007849,#0375b4,#ffce00",
            bgAlpha:"0",
            showValues:"0",
            canvasPadding:"0",
            labelDisplay:"wrap",
            labelStep: weeksPerMark,
        };

        checkDarkTheme(chartConfig, true)

        var revenueChart = revenueContainer.insertFusionCharts( {
            type: 'stackedarea2d',
            width: '100%',
            height: '100%',
            dataFormat: 'json',
            containerBackgroundOpacity :'0',
            dataSource: {
                "chart": chartConfig,
                "categories" : [{ "category" : category}],
                "dataset": [{
                    "seriesName": "Revenue (Economy)",
                    "data": revenueByClass.economy
                }, {
                    "seriesName": "Revenue (Business)",
                    "data": revenueByClass.business
                }, {
                    "seriesName": "Revenue (First)",
                    "data": revenueByClass.first
                }]
            }
        })

        chartConfig = {
            "xAxisname": xLabel,
            "YAxisName": "Ticket Price",
            //"sYAxisName": "Load Factor %",
            "numberPrefix": "$",
            "sYAxisMaxValue": "100",
            "useroundedges": "1",
            "transposeAxis": "1",
            "animation": "0",
            "showBorder": "0",
            "drawAnchors": "0",
            "toolTipBorderRadius": "2",
            "toolTipPadding": "5",
            "paletteColors": "#007849,#0375b4,#ffce00",
            "bgAlpha": "0",
            "showValues": "0",
            "canvasPadding": "0",
            "formatNumberScale": "0",
            "labelDisplay": "wrap",
            "labelStep": weeksPerMark
        }

        checkDarkTheme(chartConfig, true)

        var priceChart = priceContainer.insertFusionCharts({
            type: 'msline',
            width: '100%',
            height: '100%',
            dataFormat: 'json',
            containerBackgroundOpacity: '0',
            dataSource: {
                "chart": chartConfig,
                "categories": [{
                    "category": category
                }],
                "dataset": [{
                    "seriesName": "Price (Economy)",
                    "data": priceByClass.economy,
                }, {
                    "seriesName": "Price (Business)",
                    "data": priceByClass.business,
                }, {
                    "seriesName": "Price (First)",
                    "data": priceByClass.first,
                }]
            }
        })
    }

    function plotLinkProfit(linkConsumptions, container, plotUnit) {
        container.children(':FusionCharts').each((function(i) {
              $(this)[0].dispose();
        }))

        var data = []
        var category = []

        var profitByMark = {}
        var markOrder = []

        if (plotUnit === undefined) {
            plotUnit = plotUnitEnum.MONTH
        }

        var maxMark = plotUnit.maxMark
        var xLabel
        var yLabel
        var weeksPerMark = plotUnit.weeksPerMark
        switch (plotUnit.value) {
            case plotUnitEnum.MONTH.value:
                xLabel = 'Month'
                yLabel = 'Monthly Profit'
                break;
            case plotUnitEnum.QUARTER.value:
                xLabel = 'Quarter'
                yLabel = 'Quarterly Profit'
                break;
            case plotUnitEnum.YEAR.value:
                xLabel = 'Year'
                yLabel = 'Yearly Profit'
                break;
            case plotUnitEnum.WEEK.value:
                xLabel = 'Week'
                yLabel = 'Weekly Profit'
                break;
        }

        $.each(linkConsumptions, function(index, linkConsumption) {
            //group in months first
            var mark = Math.floor(linkConsumption.cycle / weeksPerMark)
            if (profitByMark[mark] === undefined) {
                profitByMark[mark] = linkConsumption.profit
                markOrder.push(mark)
            } else {
                profitByMark[mark] += linkConsumption.profit
            }
        })


        markOrder = markOrder.slice(0, maxMark)
        $.each(markOrder.reverse(), function(key, mark) {
            data.push({ value : profitByMark[mark] })
            category.push({ label : mark.toString() })
        })

        var chartConfig = {
                            "xAxisname": xLabel,
                            "yAxisName": yLabel,
                            "numberPrefix": "$",
                            "useroundedges": "1",
                            "animation": "0",
                            "showBorder":"0",
                            "showPlotBorder":"0",
                            "toolTipBorderRadius": "2",
                            "toolTipPadding": "5",
                            "bgAlpha": "0",
                            "showValues":"0"
                            }

        checkDarkTheme(chartConfig)

        var chart = container.insertFusionCharts({
            type: 'mscombi2d',
            width: '100%',
            height: '100%',
            containerBackgroundOpacity :'0',
            dataFormat: 'json',
            dataSource: {
                "chart": chartConfig,
                "categories" : [{ "category" : category}],
                "dataset" : [ {"data" : data}, {"renderas" : "Line", "data" : data} ]

            }
        })
    }

    function _addAllianceTooltipsToMap(airportMarkers) {
        //now add extra listener for alliance airports
        $.each(airportMarkers, function(key, marker) {
            marker.addListener('mouseover', function(event) {
                closeAlliancePopups()
                var baseInfo = marker.baseInfo
                $("#allianceBasePopup .city").html(getCountryFlagImg(baseInfo.countryCode) + "&nbsp;" + baseInfo.city)
                $("#allianceBasePopup .airportName").text(baseInfo.airportName)
                $("#allianceBasePopup .iata").html(baseInfo.airportCode)
                $("#allianceBasePopup .airlineName").html(getAirlineLogoImg(baseInfo.airlineId) + "&nbsp;" + baseInfo.airlineName)
                $("#allianceBasePopup .baseScale").html(baseInfo.scale)

                var infoWindow = new google.maps.InfoWindow({ maxWidth : 1200});
                var popup = $("#allianceBasePopup").clone()
                popup.show()
                infoWindow.setContent(popup[0])
                //infoWindow.setPosition(event.latLng);
                infoWindow.open(map, marker);
                map.allianceBasePopup = infoWindow
            })

            marker.addListener('mouseout', function(event) {
                closeAlliancePopups()
            })
        })


        switchMap();
        $("#worldMapCanvas").data("initCallback", function() { //if go back to world map, re-init the map
            map.controls[google.maps.ControlPosition.TOP_CENTER].clear()
            clearAllPaths()
            updateAirportMarkers(activeAirline)
            updateLinksInfo() //redraw all flight paths
            closeAlliancePopups()
        })

        window.setTimeout(addExitButton , 1000); //delay otherwise it doesn't push to center
    }

    window.showAllianceMap = async function showAllianceMap() {
        clearAllPaths()
        deselectLink()

        var alliancePaths = []


        $('body .loadingSpinner').show()
        const result = await _request(`alliances/${selectedAlliance.id}/details`);
        $('body .loadingSpinner').hide()

        $.each(result.links, function(index, link) {
            alliancePaths.push(drawAllianceLink(link))
        })
        var allianceBases = []
         $.each(result.members, function(index, airline) {
            if (airline.role != "APPLICANT") {
                $.merge(allianceBases, airline.bases)
            }
        })

        window.lastAllianceInfo = {
            allianceBases,
            alliancePaths,
            updateAirportBaseMarkers: () => {
                var markers = updateAirportBaseMarkers(allianceBases, alliancePaths);
                _addAllianceTooltipsToMap(markers);
            }
        };
    }


    _updateLatestOilPriceInHeader();
};

$(document).ready(() => setTimeout(() => launch(), 1000));


// Begin Cost per PAX
// Begin Cost per PAX
// Begin Cost per PAX
// Begin Cost per PAX


console.log("Plane score script loading");

function calcFlightTime(plane, distance){
    let min = Math.min;
    let max = Math.max;
    let speed = plane.speed * (plane.airplaneType.toUpperCase() == "SUPERSONIC" ? 1.5 : 1);
    let a = min(distance, 300);
    let b = min(max(0, distance-a), 400);
    let c = min(max(0, distance-(a+b)), 400);
    let d = max(0, distance-(a+b+c));

    let time_flight = a / min(speed, 350) + b / min(speed, 500) + c / min(speed, 700) + d / speed;
    return time_flight * 60;
}

function calcFuelBurn(plane, distance){
    let timeFlight = calcFlightTime(plane, distance);
    if (timeFlight > 1.5){
        return plane.fuelBurn * (405 + timeFlight);
    } else {
        return plane.fuelBurn * timeFlight * 5.5;
    }
}

function _getPlaneCategoryFor(plane) {
    switch (plane.airplaneType.toUpperCase()) {
        case 'LIGHT':
        case 'SMALL':
            return 1;
        case 'REGIONAL':
            return 3;
        case 'MEDIUM':
            return 8;
        case 'LARGE':
            return 12;
        case 'EXTRA LARGE':
        case 'X_LARGE':
            return 15;
        case 'JUMBO':
            return 18;
        case 'SUPERSONIC':
            return 12;
    }
    console.error(`BAC+CPP:Error:: Cannot get category for plane ${JSON.stringify(plane)}`)
}

let initialAirplaneModelStatsLoading = true;

window.updateAirplaneModelTable = function(sortProperty, sortOrder) {
    let distance = parseInt($("#flightRange").val(), 10);
    let runway = parseInt($("#runway").val(), 10);
    let min_capacity = parseInt($("#min_capacity").val(), 10);
    let min_circulation = parseInt($("#min_circulation").val(), 10);

    let owned_only = document.getElementById("owned_only").checked;
    let use_flight_total =document.getElementById("use_flight_total").checked;

    for (let plane of loadedModelsOwnerInfo) {
        plane.isOwned = ((plane.assignedAirplanes.length + plane.availableAirplanes.length + plane.constructingAirplanes.length) !== 0);

        if(plane.range < distance || plane.runwayRequirement > runway) {
            plane.cpp = -1;
            plane.max_rotation = -1;
            //continue;
        }
        var plane_category = _getPlaneCategoryFor(plane);
        let flightDuration = calcFlightTime(plane, distance) ;
        let price = plane.price;
        if( plane.originalPrice){
            price = plane.originalPrice;
        }

        let maxFlightMinutes = 4 * 24 * 60;
        let frequency = Math.floor(maxFlightMinutes / ((flightDuration + plane.turnaroundTime)*2));

        let flightTime = frequency * 2 * (flightDuration + plane.turnaroundTime);
        let availableFlightMinutes = maxFlightMinutes - flightTime;
        let utilisation = flightTime / (maxFlightMinutes - availableFlightMinutes);
        let planeUtilisation = (maxFlightMinutes - availableFlightMinutes) / maxFlightMinutes;

        let decayRate = 100 / (plane.lifespan * 3) * (1 + 2 * planeUtilisation);
        let depreciationRate = Math.floor(price * (decayRate / 100) * utilisation);
        let maintenance = plane.capacity * 100 * utilisation;

        let airport_fee = (500 * plane_category + plane.capacity * 10) * 2;
        let crew_cost = plane.capacity * (flightDuration / 60) * 12 ;
        let inflight_cost = (20 + 8 * flightDuration / 60) * plane.capacity * 2;

        plane.max_rotation = frequency;
        plane.fbpf = calcFuelBurn(plane, distance);
        plane.fbpp = plane.fbpf / plane.capacity;
        plane.fbpw = plane.fbpf * plane.max_rotation;
        plane.fuel_total = ((plane.fbpf * 0.08 + airport_fee + inflight_cost + crew_cost) * plane.max_rotation + depreciationRate + maintenance);
        plane.cpp = plane.fuel_total / (plane.capacity * plane.max_rotation);
        plane.max_capacity = plane.capacity * plane.max_rotation;

        plane.discountPercent = (plane.originalPrice) ? Math.round(100 - (plane.price / plane.originalPrice * 100)) : 0;

        if (!plane.in_use) {
            plane.in_use = -1;
            loadAirplaneModelStats(plane, {totalOnly: true}).then(() => {
                // This could probably be in a debounce but I'm cool with this for a final reload once stats are done.
                if (!initialAirplaneModelStatsLoading) {
                    return;
                }
                if (window.cachedTotalsById && Object.keys(window.cachedTotalsById).length === loadedModelsOwnerInfo.length) {
                    initialAirplaneModelStatsLoading = false;
                    updateAirplaneModelTable();
                }
            });
        }

        plane.shouldShow = ((plane.cpp === -1)
           || (plane.max_capacity < min_capacity)
           || (plane.range < distance)
           || (plane.runwayRequirement > runway)
           || (plane.in_use < min_circulation && !plane.isOwned)
           || (owned_only && !plane.isOwned)) === false;
    }

    if (!sortProperty && !sortOrder) {
        var selectedSortHeader = $('#airplaneModelSortHeader .cell.selected')
        sortProperty = selectedSortHeader.data('sort-property')
        if (sortProperty === 'capacity') {
            sortProperty = 'max_capacity';
        } else if (sortProperty === 'cpp' && use_flight_total) {
            sortProperty = 'fuel_total';
        }
        sortOrder = selectedSortHeader.data('sort-order')
    }
    //sort the list
    loadedModelsOwnerInfo.sort(sortByProperty(sortProperty, sortOrder == "ascending"));

    var airplaneModelTable = $("#airplaneModelTable")
    airplaneModelTable.children("div.table-row").remove()

    var cppValues = loadedModelsOwnerInfo.filter(l => l.shouldShow).map(l => l.cpp);
    var cppMax = Math.max(...cppValues);
    var cppMin = Math.max(Math.min(...cppValues), 0);

    $.each(loadedModelsOwnerInfo, function(index, modelOwnerInfo) {
        if (!modelOwnerInfo.shouldShow) {
            return;
        }

        var row = $("<div class='table-row clickable' style='"+ (modelOwnerInfo.isOwned ? "background: green;" : '') +"' data-model-id='" + modelOwnerInfo.id + "' onclick='selectAirplaneModel(loadedModelsById[" + modelOwnerInfo.id + "])'></div>")
        if (modelOwnerInfo.isFavorite) {
            row.append("<div class='cell'>" + modelOwnerInfo.name + "<img src='assets/images/icons/heart.png' height='10px'></div>")
        } else {
            row.append("<div class='cell'>" + modelOwnerInfo.name + "</div>")
        }
        row.append("<div class='cell' style='text-overflow: ellipsis;text-wrap: nowrap;overflow: clip;' title='"+modelOwnerInfo.family+"'>" + modelOwnerInfo.family + "</div>")
        row.append("<div class='cell' align='right'>" + commaSeparateNumber(modelOwnerInfo.price) + "</div>")
        row.append("<div class='cell' align='right'>" + modelOwnerInfo.capacity + " (" + (modelOwnerInfo.capacity * modelOwnerInfo.max_rotation) + ")</div>")
        row.append("<div class='cell' align='right'>" + modelOwnerInfo.range + " km</div>")
        row.append("<div class='cell' align='right'>" + modelOwnerInfo.fuelBurn + "</div>")
        row.append("<div class='cell' align='right'>" + modelOwnerInfo.lifespan / 52 + " yrs</div>")
        row.append("<div class='cell' align='right'>" + modelOwnerInfo.speed + " km/h</div>")
        row.append("<div class='cell' align='right'>" + modelOwnerInfo.runwayRequirement + " m</div>")
        row.append("<div class='cell' align='right'>" + modelOwnerInfo.assignedAirplanes.length + "/" + modelOwnerInfo.availableAirplanes.length + "/" + modelOwnerInfo.constructingAirplanes.length + "</div>")
        row.append("<div class='cell' align='right'>" + modelOwnerInfo.max_rotation + "</div>")
        row.append("<div class='cell' align='right' style='"+ getStyleFromTier(getTierFromPercent(-1*modelOwnerInfo.cpp, -1*cppMax, -1*cppMin)) +"' title='"+commaSeparateNumber(Math.round(modelOwnerInfo.fuel_total))+"/total ("+commaSeparateNumber(Math.round(modelOwnerInfo.cpp * modelOwnerInfo.capacity))+"/flight)'>" + commaSeparateNumber(Math.round(modelOwnerInfo.cpp)) + "</div>")

        let discountTier;
        if (modelOwnerInfo.discountPercent > 40) {
            discountTier = 0;
        } else if (modelOwnerInfo.discountPercent > 10) {
            discountTier = 1;
        } else if (modelOwnerInfo.discountPercent > 0) {
            discountTier = 2;
        } else {
            discountTier = 3;
        }
        row.append("<div class='cell' align='right' style='"+ getStyleFromTier(discountTier) +"' >" + modelOwnerInfo.discountPercent + "</div>")
        row.append("<div class='cell' style='"+ (modelOwnerInfo.in_use >= MIN_PLANES_TO_HIGHLIGHT ? "text-shadow: gold 0px 0px 3px;" : '') +"'  align='right'>" + modelOwnerInfo.in_use + "</div>")


        if (selectedModelId == modelOwnerInfo.id) {
            row.addClass("selected")
            selectAirplaneModel(modelOwnerInfo)
        }
        airplaneModelTable.append(row)
    });
}

const columnWidthPercents = [
    17,
    9,
    8,
    7,
    7,
    7,
    7,
    9,
    7,
    6,
    3,
    5,
    4,
    4
];

if (columnWidthPercents.reduce((sum, val) => sum += val, 0) !== 100) {
    console.warn('Column widths do not equal 100%, widths:', columnWidthPercents);
}


$("#airplaneModelSortHeader").append("<div class=\"cell clickable\" title=\"Max flight rotations (uses user-set distance above)\" data-sort-property=\"max_rotation\" data-sort-order=\"ascending\" onclick=\"toggleAirplaneModelTableSortOrder($(this))\" align=\"right\">⏲</div>");
$("#airplaneModelSortHeader").append("<div class=\"cell clickable\" title=\"Cost Per Pax\" data-sort-property=\"cpp\" data-sort-order=\"ascending\" onclick=\"toggleAirplaneModelTableSortOrder($(this))\" align=\"right\">$/🧍</div>");
$("#airplaneModelSortHeader").append("<div class=\"cell clickable\" title=\"Discount Percent (influcenced by demand & brand loyalties)\" data-sort-property=\"discountPercent\" data-sort-order=\"descending\" onclick=\"toggleAirplaneModelTableSortOrder($(this))\" align=\"right\">%🔽</div>");
$("#airplaneModelSortHeader").append("<div class=\"cell clickable\" title=\"Total number in circulation (all players, game wide)\" data-sort-property=\"in_use\" data-sort-order=\"ascending\" onclick=\"toggleAirplaneModelTableSortOrder($(this))\" align=\"right\">#✈</div>");

const headerCells = document.querySelectorAll('#airplaneModelSortHeader .cell');
for (var i = 0; i < headerCells.length; i++) {
    headerCells[i].style = `width: ${columnWidthPercents[i]}%`
}

$('#airplaneModelTable .table-header').html(`
    <div class="cell" style="width: ${columnWidthPercents[0]}%; border-bottom: none;"></div>
    <div class="cell" style="width: ${columnWidthPercents[1]}%; border-bottom: none;"></div>
    <div class="cell" style="width:  ${columnWidthPercents[2]}%; border-bottom: none;"></div>
    <div class="cell" style="width:  ${columnWidthPercents[3]}%; border-bottom: none;"></div>
    <div class="cell" style="width:  ${columnWidthPercents[4]}%; border-bottom: none;"></div>
    <div class="cell" style="width:  ${columnWidthPercents[5]}%; border-bottom: none;"></div>
    <div class="cell" style="width:  ${columnWidthPercents[6]}%; border-bottom: none;"></div>
    <div class="cell" style="width:  ${columnWidthPercents[7]}%; border-bottom: none;"></div>
    <div class="cell" style="width:  ${columnWidthPercents[8]}%; border-bottom: none;"></div>
    <div class="cell" style="width:  ${columnWidthPercents[9]}%; border-bottom: none;"></div>
    <div class="cell" style="width:  ${columnWidthPercents[10]}%; border-bottom: none;"></div><!-- New columns -->
    <div class="cell" style="width:  ${columnWidthPercents[11]}%; border-bottom: none;"></div><!-- New columns -->
    <div class="cell" style="width:  ${columnWidthPercents[12]}%; border-bottom: none;"></div><!-- New columns -->
    <div class="cell" style="width:  ${columnWidthPercents[13]}%; border-bottom: none;"></div><!-- New columns -->
`);

$("#airplaneCanvas .mainPanel .section .table .table-header:first").append(`
    <div class="cell detailsSelection">Distance: <input type="text" id="flightRange" value="${DEFAULT_MIN_FLIGHT_RANGE_FILTER}" /></div>
    <div class="cell detailsSelection">Runway length: <input type="text" id="runway" value="${DEFAULT_RUNWAY_LENGTH_FILTER}" /></div>
    <div class="cell detailsSelection">Min. Capacity: <input type="text" id="min_capacity" value="${DEFAULT_MIN_CAPACITY_FILTER}" /></div>
    <div class="cell detailsSelection">Min. Circulation: <input type="text" id="min_circulation" value="${DEFAULT_MIN_PLANES_IN_CIRCULATION_FILTER}" /></div>
    <div class="cell detailsSelection" style="min-width: 160px; text-align:right">
        <label for="owned_only">Owned Only <input type="checkbox" id="owned_only" /></label>
        <label for="use_flight_total">Flight Fuel Total <input type="checkbox" id="use_flight_total" /></label>
    </div>
`);


$("#airplaneCanvas .mainPanel .section .detailsGroup .market.details").attr({style: 'width: 100%; height: calc(100% - 30px); display: block;'});

$('[data-sort-property="totalOwned"]').text('Owned')
$('[data-sort-property="totalOwned"]').attr({style: 'width: 6%;'});


var newDataFilterElements = [
    '#flightRange',
    '#runway',
    '#min_capacity',
    '#min_circulation',
    '#owned_only',
    '#use_flight_total',
]

for (var el of newDataFilterElements) {
    $(el).change(function(){window.updateAirplaneModelTable()});
}

//* Link Cost Preview

let _updatePlanLinkInfo = window.updatePlanLinkInfo;
let _updateTotalValues = window.updateTotalValues;

window.latestActiveLink = null;

let activeLink;
let idFrom = -1;
let idTo = -1;
let airportFrom;
let airportTo;
let _modelId = -1;

let observer = new MutationObserver(function(mutations) {
    updateModelInfo(_modelId);
});

observer.observe(
    document.getElementById('planLinkServiceLevel'), {
        attributes: true,
        attributeFilter: ['value']
    }
);

window.updateTotalValues = function(){
    _updateTotalValues();
    window.updateModelInfo(_modelId);
}

window.updatePlanLinkInfo = function(linkInfo){
    //console.log(linkInfo);
    window.latestActiveLink = activeLink = linkInfo;

    for (let model of activeLink.modelPlanLinkInfo){
        for (let airplane of model.airplanes){
            airplane.airplane.frequency = airplane.frequency;
        }
    }

    if (idFrom != linkInfo.fromAirportId){
        idFrom = linkInfo.fromAirportId
        $.ajax({
            url:"airports/" + linkInfo.fromAirportId,
            async : false,
            success: function(result){airportFrom = result},
        });
    }

    if (idTo != linkInfo.toAirportId){
        idTo = linkInfo.toAirportId
        $.ajax({
            url:"airports/" + linkInfo.toAirportId,
            async : false,
            success: function(result){airportTo = result},
        });
    }

    _updatePlanLinkInfo(linkInfo);
}

let _updateModelInfo = window.updateModelInfo;

window.updateModelInfo = function(modelId) {
    if (_modelId != modelId){
        _updateModelInfo(modelId);
    }
    _modelId = modelId;

    let model = loadedModelsById[modelId];
    let linkModel = activeLink.modelPlanLinkInfo.find(plane => plane.modelId == modelId);

    //console.log({loadedModelsById, model, linkModel})
    let serviceLevel = parseInt($("#planLinkServiceLevel").val());
    let frequency = 0;

    let plane_category = _getPlaneCategoryFor(model);

    let baseSlotFee = 0;

    switch (airportFrom.size){
        case 1 :
        case 2 : baseSlotFee=50;break;
        case 3 : baseSlotFee=80;break;
        case 4 : baseSlotFee=150;break;
        case 5 : baseSlotFee=250;break;
        case 6 : baseSlotFee=350;break;
        default: baseSlotFee=500;break;
    }

    switch (airportTo.size){
        case 1 :
        case 2 : baseSlotFee+=50;break;
        case 3 : baseSlotFee+=80;break;
        case 4 : baseSlotFee+=150;break;
        case 5 : baseSlotFee+=250;break;
        case 6 : baseSlotFee+=350;break;
        default: baseSlotFee+=500;break;
    }

    let serviceLevelCost = 1;

    switch (serviceLevel) {
        case 2:serviceLevelCost=4;break;
        case 3:serviceLevelCost=8;break;
        case 4:serviceLevelCost=13;break;
        case 5:serviceLevelCost=20;break;
    }

    let basic = 0;
    let multiplyFactor = 2;
    if (airportFrom.countryCode == airportTo.countryCode) {
        if (activeLink.distance <= 1000) {
            basic = 8;
        } else if (activeLink.distance <= 3000) {
            basic = 10;
        } else {
            basic = 12;
        }
    } else if (airportFrom.zone == airportTo.zone){
        if (activeLink.distance <= 2000) {
            basic = 10;
        } else if (activeLink.distance <= 4000) {
            basic = 15;
        } else {
            basic = 20;
        }
    } else {
        if (activeLink.distance <= 2000) {
            basic = 15;
            multiplyFactor = 3;
        } else if (activeLink.distance <= 5000) {
            basic = 25;
            multiplyFactor = 3;
        } else if (activeLink.distance <= 12000) {
            basic = 30;
            multiplyFactor = 4;
        } else {
            basic = 30;
            multiplyFactor = 4;
        }
    }

    let staffPerFrequency = multiplyFactor * 0.4;
    let staffPer1000Pax = multiplyFactor;


    let durationInHour = linkModel.duration / 60;

    let price = model.price;
    if( model.originalPrice){
        price = model.originalPrice;
    }
    let baseDecayRate = 100 / model.lifespan;

    let maintenance = 0;
    let depreciationRate = 0;

    for (let row of $(".frequencyDetail .airplaneRow")) {
        let airplane = $(row).data("airplane");
        let freq = parseInt($(row).children(".frequency").val());
        let futureFreq = freq - airplane.frequency;
        let flightTime = freq * 2 * (linkModel.duration + model.turnaroundTime);

        let availableFlightMinutes = airplane.availableFlightMinutes - (futureFreq * 2 * (linkModel.duration + model.turnaroundTime));

        let utilisation = flightTime / (airplane.maxFlightMinutes - availableFlightMinutes);
        let planeUtilisation = (airplane.maxFlightMinutes - availableFlightMinutes) / airplane.maxFlightMinutes;

        let decayRate = 100 / (model.lifespan * 3) * (1 + 2 * planeUtilisation);

        depreciationRate += Math.floor(price * (decayRate / 100) * utilisation);

        maintenance += model.capacity * 100 * utilisation;

        frequency += freq;
    }

    if (frequency == 0){
        let maxFlightMinutes = 4 * 24 * 60;
        frequency = Math.floor(maxFlightMinutes / ((linkModel.duration + model.turnaroundTime)*2));

        let flightTime = frequency * 2 * (linkModel.duration + model.turnaroundTime);
        let availableFlightMinutes = maxFlightMinutes - flightTime;
        let utilisation = flightTime / (maxFlightMinutes - availableFlightMinutes);
        let planeUtilisation = (maxFlightMinutes - availableFlightMinutes) / maxFlightMinutes;

        let decayRate = 100 / (model.lifespan * 3) * (1 + 2 * planeUtilisation);
        depreciationRate += Math.floor(price * (decayRate / 100) * utilisation);
        maintenance += model.capacity * 100 * utilisation;
    }

    let fuelCost = frequency;

    if (linkModel.duration <= 90){
        fuelCost *= model.fuelBurn * linkModel.duration * 5.5 * 0.08;
    }else{
        fuelCost *= model.fuelBurn * (linkModel.duration + 405) * 0.08;
    }

    let crewCost = model.capacity * durationInHour * 12 * frequency;
    let airportFees = (baseSlotFee * plane_category + (Math.min(3, airportTo.size) + Math.min(3, airportFrom.size)) * model.capacity) * frequency;
    let servicesCost = (20 + serviceLevelCost * durationInHour) * model.capacity * 2 * frequency;
    let cost = fuelCost + crewCost + airportFees + depreciationRate + servicesCost + maintenance;

    let staffTotal = Math.floor(basic + staffPerFrequency * frequency + staffPer1000Pax * model.capacity * frequency / 1000);

    $('#airplaneModelDetails #FCPF').text("$" + commaSeparateNumber(Math.floor(fuelCost)));
    $('#airplaneModelDetails #CCPF').text("$" + commaSeparateNumber(Math.floor(crewCost)));
    $('#airplaneModelDetails #AFPF').text("$" + commaSeparateNumber(airportFees));
    $('#airplaneModelDetails #depreciation').text("$" + commaSeparateNumber(Math.floor(depreciationRate)));
    $('#airplaneModelDetails #SSPF').text("$" + commaSeparateNumber(Math.floor(servicesCost)));
    $('#airplaneModelDetails #maintenance').text("$" + commaSeparateNumber(Math.floor(maintenance)));
    $('#airplaneModelDetails #cpp').text("$" + commaSeparateNumber(Math.floor(cost / (model.capacity * frequency))) + " * " + (model.capacity * frequency));
    $('#airplaneModelDetails #cps').text("$" + commaSeparateNumber(Math.floor(cost / staffTotal)) + " * " + staffTotal);
}

$("#airplaneModelDetails #speed").parent().after(`
<div class="table-row">
    <div class="label">&#8205;</div>
</div>
<div class="table-row">
    <div class="label">
        <h5>--  Costs  --</h5>
    </div>
</div>
<div class="table-row">
    <div class="label">
        <h5>Fuel cost:</h5>
    </div>
    <div class="value" id="FCPF"></div>
</div>
<div class="table-row">
    <div class="label">
        <h5>Crew cost:</h5>
    </div>
    <div class="value" id="CCPF"></div>
</div>
<div class="table-row">
    <div class="label">
        <h5>Airport fees:</h5>
    </div>
    <div class="value" id="AFPF"></div>
</div>
<div class="table-row">
    <div class="label">
        <h5>Depreciation (wip):</h5>
    </div>
    <div class="value" id="depreciation"></div>
</div>
<div class="table-row">
    <div class="label">
        <h5>Service supplies:</h5>
    </div>
    <div class="value" id="SSPF"></div>
</div>
<div class="table-row">
    <div class="label">
        <h5>Maintenance (wip):</h5>
    </div>
    <div class="value" id="maintenance"></div>
</div>
<div class="table-row">
    <div class="label">
        <h5>Cost per PAX:</h5>
    </div>
    <div class="value" id="cpp"></div>
</div>
<div class="table-row">
    <div class="label">
        <h5>Cost per staff:</h5>
    </div>
    <div class="value" id="cps"></div>
</div>
<div class="table-row">
    <div class="label">&#8205;</div>
</div>`);

if (REMOVE_MOVING_BACKGROUND === true) {
    setTimeout(() => {
        $('body').attr({style:`background: ${SOLID_BACKGROUND_COLOR};background-color: ${SOLID_BACKGROUND_COLOR};background-image: none;`});
    },1500);
}

console.log("BetterAirlineClub + Cost per PAX scripts loaded");










(function() {
    'use strict';

    let map = null;
    let distanceCircles = [];
    let inputBox = null;
    let statusDiv = null;

    // Wait for Google Maps to load
    function waitForMap() {
        // Check if Google Maps API is available
        if (typeof google !== 'undefined' && google.maps) {
            // Try to find the map object in window or common variables
            setTimeout(() => {
                // Common map variable names used in web apps
                const possibleMapVars = ['map', 'googleMap', 'gmap', 'mainMap'];

                for (let varName of possibleMapVars) {
                    if (window[varName] && window[varName].getCenter) {
                        map = window[varName];
                        console.log('Airline Club Distance Script: Found map via window.' + varName);
                        break;
                    }
                }

                // Alternative approach: try to find map through DOM elements
                if (!map) {
                    // Look for map containers and try to extract map instance
                    const mapElements = document.querySelectorAll('[id*="map"], [class*="map"], .gm-style');
                    for (let element of mapElements) {
                        // Check if element has map data
                        if (element.__gm && element.__gm.map) {
                            map = element.__gm.map;
                            console.log('Airline Club Distance Script: Found map via DOM element');
                            break;
                        }
                    }
                }

                if (!map) {
                    console.log('Airline Club Distance Script: Map reference not found, creating UI anyway');
                }

                initializeUI();
            }, 2000);
        } else {
            setTimeout(waitForMap, 1000);
        }
    }

    // Initialize the user interface
    function initializeUI() {
        addMenuButton();
        createInputInterface();
        console.log('Airline Club Distance Script: Initialized');
    }

    // Add button to menu
    function addMenuButton() {
        // Instead of trying to integrate with existing menu, create our own positioned button
        const distanceButton = document.createElement('button');
        distanceButton.textContent = 'Distance Circles';
        distanceButton.id = 'distance-circles-btn';

        // Force button to bottom-right corner regardless of menu location
        distanceButton.style.cssText = `
            position: fixed;
            bottom: 60px;
            right: 10px;
            background: #4CAF50;
            color: white;
            border: 1px solid #45a049;
            padding: 3px 6px;
            cursor: pointer;
            border-radius: 3px;
            font-size: 11px;
            font-weight: normal;
            text-align: center;
            z-index: 10001;
            white-space: nowrap;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        `;

        distanceButton.addEventListener('click', toggleInputInterface);
        document.body.appendChild(distanceButton);
    }

    // Remove the fallback function since we're always using positioned button
    function createFallbackToggle() {
        // This function is not needed since addMenuButton handles positioning
        return;
    }

    // Toggle input interface visibility
    function toggleInputInterface() {
        if (!inputBox) return;

        const container = inputBox.closest('div');
        if (container.style.display === 'none') {
            container.style.display = 'block';
        } else {
            container.style.display = 'none';
        }
    }

    // Create the input interface
    function createInputInterface() {
        // Create container
        const container = document.createElement('div');
        container.style.cssText = `
            position: fixed;
            bottom: 10px;
            right: 10px;
            background: rgba(255, 255, 255, 0.95);
            border: 2px solid #4CAF50;
            border-radius: 8px;
            padding: 12px;
            z-index: 10000;
            font-family: Arial, sans-serif;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
            min-width: 250px;
            display: none;
        `;

        // Close button for the interface
        const closeButton = document.createElement('button');
        closeButton.innerHTML = '×';
        closeButton.style.cssText = `
            position: absolute;
            top: 5px;
            right: 8px;
            background: none;
            border: none;
            font-size: 18px;
            font-weight: bold;
            color: #999;
            cursor: pointer;
            width: 20px;
            height: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        closeButton.addEventListener('click', toggleInputInterface);

        // Title
        const title = document.createElement('div');
        title.textContent = 'Distance Circles';
        title.style.cssText = `
            font-weight: bold;
            margin-bottom: 8px;
            color: #333;
            font-size: 14px;
            padding-right: 20px;
        `;

        // Input box
        inputBox = document.createElement('input');
        inputBox.type = 'text';
        inputBox.placeholder = 'e.g., 2000km@cdg';
        inputBox.style.cssText = `
            width: 100%;
            padding: 6px;
            border: 1px solid #ccc;
            border-radius: 4px;
            margin-bottom: 8px;
            font-size: 12px;
            box-sizing: border-box;
        `;

        // Button container
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; gap: 5px; margin-bottom: 8px;';

        // Add button
        const addButton = document.createElement('button');
        addButton.textContent = 'Add Circle';
        addButton.style.cssText = `
            flex: 1;
            padding: 6px;
            background: #4CAF50;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        `;

        // Clear button
        const clearButton = document.createElement('button');
        clearButton.textContent = 'Clear All';
        clearButton.style.cssText = `
            flex: 1;
            padding: 6px;
            background: #f44336;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        `;

        // Status div
        statusDiv = document.createElement('div');
        statusDiv.style.cssText = `
            font-size: 11px;
            color: #666;
            min-height: 16px;
        `;

        // Help text
        const helpText = document.createElement('div');
        helpText.innerHTML = `
            <strong>Format:</strong> distance@airport<br>
            <small>e.g.: 2000km@cdg, 1500nm@lhr, 4000mi@jfk</small>
        `;
        helpText.style.cssText = `
            font-size: 10px;
            color: #888;
            margin-top: 8px;
            line-height: 1.3;
        `;

        // Event listeners
        addButton.addEventListener('click', handleAddCircle);
        clearButton.addEventListener('click', clearAllCircles);
        inputBox.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleAddCircle();
        });

        // Assemble interface
        buttonContainer.appendChild(addButton);
        buttonContainer.appendChild(clearButton);

        container.appendChild(closeButton);
        container.appendChild(title);
        container.appendChild(inputBox);
        container.appendChild(buttonContainer);
        container.appendChild(statusDiv);
        container.appendChild(helpText);

        document.body.appendChild(container);
    }

    // Handle adding a distance circle
    function handleAddCircle() {
        const input = inputBox.value.trim();
        if (!input) {
            updateStatus('Please enter a distance and airport code', 'error');
            return;
        }

        const parsed = parseInput(input);
        if (!parsed) {
            updateStatus('Invalid format. Use: distance@airport (e.g., 2000km@cdg)', 'error');
            return;
        }

        if (!map) {
            updateStatus('Map not found. Make sure you\'re on a page with the map loaded.', 'error');
            return;
        }

        addDistanceCircle(parsed.distance, parsed.unit, parsed.airport);
        inputBox.value = '';
    }

    // Parse input format: distance@airport
    function parseInput(input) {
        const match = input.match(/^(\d+(?:\.\d+)?)(km|mi|miles?|kilometers?|nm|nautical|nmi)?@([a-zA-Z]{3,4})$/i);
        if (!match) return null;

        const distance = parseFloat(match[1]);
        let unit = (match[2] || 'km').toLowerCase();
        const airport = match[3].toLowerCase();

        // Normalize unit
        if (unit.startsWith('mi')) unit = 'mi';
        else unit = 'km';

        return { distance, unit, airport };
    }

    // Add distance circle to map
    async function addDistanceCircle(distance, unit, airportCode) {
        try {
            if (!map) {
                updateStatus('Map not available', 'error');
                return;
            }

            const coords = await getAirportCoordinates(airportCode);
            if (!coords) {
                updateStatus(`Airport ${airportCode.toUpperCase()} not found`, 'error');
                return;
            }

            // Convert distance to meters
            const distanceInMeters = unit === 'mi' ? distance * 1609.34 :
                                   unit === 'nm' ? distance * 1852 :
                                   distance * 1000;

            // Create circle with explicit zIndex to ensure it doesn't interfere
            const circle = new google.maps.Circle({
                strokeColor: '#FF0000',
                strokeOpacity: 0.6,
                strokeWeight: 2,
                fillColor: '#FF0000',
                fillOpacity: 0.1,  // Reduced opacity to be less intrusive
                map: map,
                center: coords,
                radius: distanceInMeters,
                zIndex: -1,  // Put circles behind other map elements
                clickable: false  // Prevent circles from intercepting clicks
            });

            // Create a subtle center marker
            const marker = new google.maps.Marker({
                position: coords,
                map: map,
                title: `${airportCode.toUpperCase()}: ${distance}${unit} radius`,
                zIndex: 0,  // Keep markers at default level
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 5,  // Smaller marker
                    fillColor: '#FF0000',
                    fillOpacity: 0.7,
                    strokeColor: '#FFFFFF',
                    strokeWeight: 1
                }
            });

            // Store with cleanup function
            const circleData = {
                circle,
                marker,
                airport: airportCode.toUpperCase(),
                distance,
                unit,
                cleanup: function() {
                    if (this.circle) {
                        this.circle.setMap(null);
                        this.circle = null;
                    }
                    if (this.marker) {
                        this.marker.setMap(null);
                        this.marker = null;
                    }
                }
            };

            distanceCircles.push(circleData);
            updateStatus(`Added ${distance}${unit} circle around ${airportCode.toUpperCase()}`, 'success');

        } catch (error) {
            console.error('Distance Circles Error:', error);
            updateStatus(`Error: ${error.message}`, 'error');
        }
    }


    async function getAirportCoordinates(airportCode) {

        const commonAirports = {
            // Airports
'aac': { lat:31.073299408, lng:33.8358001709 },
'aae': { lat:36.822201, lng:7.809174 },
'aak': { lat:0.185278, lng:173.636993 },
'aal': { lat:57.0927589138, lng:9.84924316406 },
'aam': { lat:-24.8180999755859, lng:31.5445995330811 },
'aan': { lat:24.2616996765137, lng:55.6091995239258 },
'aap': { lat:-0.374448, lng:117.249392 },
'aaq': { lat:45.002101898193, lng:37.347301483154 },
'aar': { lat:56.2999992371, lng:10.6190004349 },
'aat': { lat:47.7498855591, lng:88.0858078003 },
'aau': { lat:-13.505132, lng:-172.627888 },
'aax': { lat:-19.563199996948, lng:-46.960399627686 },
'aaz': { lat:14.8656, lng:-91.501999 },
'aba': { lat:53.7400016784668, lng:91.3850021362305 },
'abc': { lat:38.9485015869, lng:-1.86352002621 },
'abd': { lat:30.371099472, lng:48.2282981873 },
'abe': { lat:40.652099609375, lng:-75.440803527832 },
'abi': { lat:32.4113006592, lng:-99.6819000244 },
'abj': { lat:5.261390209198, lng:-3.9262900352478 },
'abm': { lat:-10.9508, lng:142.459 },
'abq': { lat:35.040199, lng:-106.609001 },
'abr': { lat:45.4491004943848, lng:-98.4217987060547 },
'abs': { lat:22.3759994507, lng:31.611700058 },
'abt': { lat:20.2961006165, lng:41.6343002319 },
'abv': { lat:9.00679016113281, lng:7.26316976547241 },
'abx': { lat:-36.067798614502, lng:146.957992553711 },
'aby': { lat:31.5354995727539, lng:-84.1945037841797 },
'abz': { lat:57.2019004821777, lng:-2.19777989387512 },
'aca': { lat:16.7570991516113, lng:-99.7539978027344 },
'acc': { lat:5.60518980026245, lng:-0.166786000132561 },
'ace': { lat:28.945499, lng:-13.6052 },
'ach': { lat:47.4850006104, lng:9.56077003479 },
'aci': { lat:49.706104, lng:-2.21472 },
'ack': { lat:41.25310135, lng:-70.06020355 },
'act': { lat:31.6112995147705, lng:-97.2304992675781 },
'acv': { lat:40.978101, lng:-124.109 },
'acy': { lat:39.4575996398926, lng:-74.5772018432617 },
'ada': { lat:36.9822006226, lng:35.2803993225 },
'adb': { lat:38.2924003601, lng:27.156999588 },
'add': { lat:8.97789001465, lng:38.7993011475 },
'ade': { lat:12.8295001983643, lng:45.0288009643555 },
'adf': { lat:37.7313995361, lng:38.4688987732 },
'adj': { lat:31.9727001190186, lng:35.9916000366211 },
'adl': { lat:-34.945, lng:138.531006 },
'adq': { lat:57.75, lng:-152.4940033 },
'adu': { lat:38.3256988525, lng:48.4244003296 },
'adz': { lat:12.5836, lng:-81.7112 },
'aeb': { lat:23.7206001282, lng:106.959999084 },
'aeg': { lat:1.4001, lng:99.430496 },
'aep': { lat:-34.5592, lng:-58.4156 },
'aer': { lat:43.449902, lng:39.9566 },
'aes': { lat:62.5625, lng:6.11969995498657 },
'aex': { lat:31.3274002075195, lng:-92.5497970581055 },
'aey': { lat:65.6600036621094, lng:-18.0727005004883 },
'afa': { lat:-34.588299, lng:-68.4039 },
'aft': { lat:-9.19138888889, lng:160.948611111 },
'afz': { lat:36.168098449707, lng:57.5951995849609 },
'aga': { lat:30.3250007629395, lng:-9.41306972503662 },
'agf': { lat:44.1747016906738, lng:0.590556025505066 },
'agh': { lat:56.2961006164551, lng:12.8471002578735 },
'agp': { lat:36.6749000549316, lng:-4.49911022186279 },
'ags': { lat:33.3698997497559, lng:-81.9645004272461 },
'agt': { lat:-25.454516, lng:-54.842682 },
'agu': { lat:21.705601, lng:-102.318001 },
'agv': { lat:9.55337524414063, lng:-69.2378692626953 },
'ahb': { lat:18.2404003143, lng:42.6566009521 },
'ahn': { lat:33.948600769043, lng:-83.326301574707 },
'aho': { lat:40.632099, lng:8.29077 },
'ahu': { lat:35.1771011352539, lng:-3.83951997756958 },
'aim': { lat:10.216799736023, lng:169.983001708984 },
'aip': { lat:31.4338, lng:75.758797 },
'aja': { lat:41.9235992431641, lng:8.8029203414917 },
'ajf': { lat:29.7851009368897, lng:40.0999984741211 },
'aji': { lat:39.654541015625, lng:43.0259780883789 },
'ajl': { lat:23.8405990601, lng:92.6196975708 },
'ajr': { lat:65.5903015136719, lng:19.2819004058838 },
'aju': { lat:-10.984, lng:-37.070301 },
'ajy': { lat:16.9659996032715, lng:8.00010967254639 },
'akf': { lat:24.1786994934082, lng:23.3139991760254 },
'akj': { lat:43.6707992553711, lng:142.447006225586 },
'akl': { lat:-37.0080986023, lng:174.792007446 },
'akr': { lat:7.24673986434937, lng:5.30101013183594 },
'aks': { lat:-8.70257, lng:160.682007 },
'aku': { lat:41.262501, lng:80.291702 },
'akx': { lat:50.2458, lng:57.206699 },
'aky': { lat:20.1326999664307, lng:92.8725967407227 },
'ala': { lat:43.3521003723145, lng:77.0404968261719 },
'alb': { lat:42.7482986450195, lng:-73.8016967773438 },
'alc': { lat:38.2821998596191, lng:-0.55815601348877 },
'alf': { lat:69.976097106934, lng:23.371700286865 },
'alg': { lat:36.691002, lng:3.21541 },
'alh': { lat:-34.9432983398438, lng:117.80899810791 },
'all': { lat:44.050598, lng:8.12743 },
'alo': { lat:42.5570983886719, lng:-92.4002990722656 },
'alp': { lat:36.1806983947754, lng:37.2243995666504 },
'als': { lat:37.434898, lng:-105.866997 },
'alw': { lat:46.09489822, lng:-118.288002 },
'ama': { lat:35.219398, lng:-101.706001 },
'amd': { lat:23.0771999359, lng:72.6346969604 },
'amh': { lat:6.03939008712769, lng:37.5904998779297 },
'amm': { lat:31.7226009369, lng:35.9931983948 },
'amq': { lat:-3.7102599144, lng:128.089004517 },
'ams': { lat:52.308601, lng:4.76389 },
'anc': { lat:61.1744003295898, lng:-149.996002197266 },
'ane': { lat:47.560299, lng:-0.312222 },
'anf': { lat:-23.444501, lng:-70.445099 },
'ang': { lat:45.7291984558106, lng:0.221456006169319 },
'ann': { lat:55.0424003601074, lng:-131.572006225586 },
'anr': { lat:51.1894, lng:4.46028 },
'ans': { lat:-13.7063999176025, lng:-73.3504028320313 },
'anu': { lat:17.1367, lng:-61.792702 },
'anx': { lat:69.292503356934, lng:16.144199371338 },
'aoe': { lat:39.809898, lng:30.5194 },
'aog': { lat:41.105301, lng:122.853996 },
'aoi': { lat:43.616299, lng:13.3623 },
'aoj': { lat:40.7346992492676, lng:140.690994262695 },
'aoo': { lat:40.29639816, lng:-78.31999969 },
'aor': { lat:6.18967008590698, lng:100.398002624512 },
'aot': { lat:45.738499, lng:7.36872 },
'apl': { lat:-15.1056003570557, lng:39.2817993164063 },
'apn': { lat:45.0780983, lng:-83.56030273 },
'apo': { lat:7.81196, lng:-76.7164 },
'apw': { lat:-13.8299999237061, lng:-172.007995605469 },
'aqa': { lat:-21.812, lng:-48.132999 },
'aqg': { lat:30.582199, lng:117.050003 },
'aqi': { lat:28.335199, lng:46.125099 },
'aqj': { lat:29.6116008758545, lng:35.0181007385254 },
'aqp': { lat:-16.3411006927, lng:-71.5830993652 },
'arh': { lat:64.6003036499023, lng:40.7167015075684 },
'ari': { lat:-18.348499, lng:-70.338699 },
'ark': { lat:-3.36778998374939, lng:36.63330078125 },
'arm': { lat:-30.5280990601, lng:151.617004395 },
'arn': { lat:59.651901245117, lng:17.918600082397 },
'art': { lat:43.9919013977051, lng:-76.0216979980469 },
'aru': { lat:-21.141479, lng:-50.424575 },
'arw': { lat:46.1766014099121, lng:21.261999130249 },
'arx': { lat:-4.568611, lng:-37.804722 },
'asb': { lat:37.986801, lng:58.361 },
'ase': { lat:39.22320175, lng:-106.8690033 },
'asf': { lat:46.2832984924, lng:48.0063018799 },
'asj': { lat:28.4305992126465, lng:129.712997436523 },
'asm': { lat:15.2918996810913, lng:38.910701751709 },
'aso': { lat:10.018500328064, lng:34.5862998962402 },
'asp': { lat:-23.8066997528076, lng:133.901992797852 },
'asr': { lat:38.770401001, lng:35.4953994751 },
'asu': { lat:-25.2399997711182, lng:-57.5200004577637 },
'asw': { lat:23.9643993378, lng:32.8199996948 },
'atb': { lat:17.7103443145752, lng:34.0570182800293 },
'atd': { lat:-8.87333, lng:161.011002 },
'ath': { lat:37.9364013672, lng:23.9444999695 },
'atl': { lat:33.6367, lng:-84.428101 },
'atm': { lat:-3.2539100646973, lng:-52.254001617432 },
'atq': { lat:31.7096004486, lng:74.7973022461 },
'aty': { lat:44.91400146, lng:-97.15470123 },
'atz': { lat:27.050754, lng:31.01625 },
'aua': { lat:12.5014, lng:-70.015198 },
'auc': { lat:7.06888, lng:-70.7369 },
'aug': { lat:44.3205986023, lng:-69.7973022461 },
'auh': { lat:24.4330005645752, lng:54.6511001586914 },
'aul': { lat:8.14527988433838, lng:171.173004150391 },
'auq': { lat:-9.76879024506, lng:-139.011001587 },
'aur': { lat:44.8913993835449, lng:2.42194008827209 },
'aus': { lat:30.1944999694824, lng:-97.6698989868164 },
'auu': { lat:-13.354067, lng:141.72065 },
'aux': { lat:-7.22787, lng:-48.240501 },
'auy': { lat:-20.2492008209, lng:169.770996094 },
'avi': { lat:22.027099609375, lng:-78.7895965576172 },
'avk': { lat:46.250301361084, lng:102.802001953125 },
'avl': { lat:35.436199, lng:-82.541801 },
'avn': { lat:43.9072990417481, lng:4.90183019638062 },
'avp': { lat:41.3385009766, lng:-75.7233963013 },
'avv': { lat:-38.039398, lng:144.468994 },
'awd': { lat:-19.2346, lng:169.6009 },
'awz': { lat:31.3374004364, lng:48.7620010376 },
'axa': { lat:18.2048, lng:-63.055099 },
'axd': { lat:40.855899810791, lng:25.9563007354736 },
'axf': { lat:38.74831, lng:105.58858 },
'axj': { lat:32.482498, lng:130.158997 },
'axm': { lat:4.45278, lng:-75.7664 },
'axt': { lat:39.6156005859375, lng:140.218994140625 },
'axu': { lat:14.1468000411987, lng:38.7728004455566 },
'ayp': { lat:-13.1548004150391, lng:-74.2043991088867 },
'ayq': { lat:-25.1861, lng:130.975998 },
'ayt': { lat:36.898701, lng:30.800501 },
'azd': { lat:31.9048995972, lng:54.2765007019 },
'azn': { lat:40.7276992798, lng:72.2939987183 },
'azo': { lat:42.2349014282227, lng:-85.5521011352539 },
'azr': { lat:27.8376007080078, lng:-0.186414003372192 },
'azs': { lat:19.2670001984, lng:-69.7419967651 },
'bag': { lat:16.3750991821289, lng:120.620002746582 },
'bah': { lat:26.2707996368408, lng:50.6335983276367 },
'bal': { lat:37.9290008545, lng:41.1166000366 },
'baq': { lat:10.8896, lng:-74.7808 },
'bar': { lat:19.13824, lng:110.454775 },
'bav': { lat:40.560001373291, lng:109.997001647949 },
'bax': { lat:53.3638000488281, lng:83.5384979248047 },
'bay': { lat:47.660598, lng:23.467252 },
'baz': { lat:-0.981292, lng:-62.919601 },
'bba': { lat:-45.9160995483398, lng:-71.6894989013672 },
'bbg': { lat:3.08583, lng:172.811005 },
'bbi': { lat:20.2444000244, lng:85.8178024292 },
'bbm': { lat:13.0956001281738, lng:103.223999023438 },
'bbo': { lat:10.3892002105713, lng:44.9411010742188 },
'bca': { lat:20.3652992248535, lng:-74.5062026977539 },
'bcd': { lat:10.7764, lng:123.014999 },
'bci': { lat:-23.5652999878, lng:145.307006836 },
'bcl': { lat:10.7686996459961, lng:-83.5856018066406 },
'bcm': { lat:46.521900177002, lng:26.9102993011475 },
'bcn': { lat:41.2971, lng:2.07846 },
'bcu': { lat:10.482833, lng:9.744 },
'bda': { lat:32.3639984130859, lng:-64.6787033081055 },
'bdb': { lat:-24.9039001465, lng:152.319000244 },
'bdd': { lat:-10.1499996185, lng:142.1734 },
'bdj': { lat:-3.44235992431641, lng:114.763000488281 },
'bdl': { lat:41.9388999939, lng:-72.6831970215 },
'bdo': { lat:-6.90062999725342, lng:107.575996398926 },
'bdq': { lat:22.336201, lng:73.226303 },
'bdr': { lat:41.163501739502, lng:-73.1261978149414 },
'bds': { lat:40.6576, lng:17.947001 },
'bdt': { lat:4.25321006774902, lng:20.9752998352051 },
'bdu': { lat:69.055801391602, lng:18.540399551392 },
'bef': { lat:11.9910001754761, lng:-83.7741012573242 },
'beg': { lat:44.8184013367, lng:20.3090991974 },
'bei': { lat:9.38639, lng:34.5219 },
'bel': { lat:-1.37925004959, lng:-48.4762992859 },
'bem': { lat:32.401895, lng:-6.315905 },
'ben': { lat:32.0968017578, lng:20.2695007324 },
'ber': { lat:52.351389, lng:13.493889 },
'bes': { lat:48.4478988647461, lng:-4.41854000091553 },
'bew': { lat:-19.7964000701904, lng:34.907600402832 },
'bey': { lat:33.8208999633789, lng:35.4883995056152 },
'bfd': { lat:41.8031005859375, lng:-78.6400985717773 },
'bff': { lat:41.87400055, lng:-103.5960007 },
'bfi': { lat:47.5299987792969, lng:-122.302001953125 },
'bfj': { lat:27.267066, lng:105.472097 },
'bfn': { lat:-29.092699, lng:26.302401 },
'bfs': { lat:54.6575012207, lng:-6.21582984924 },
'bfv': { lat:15.2294998168945, lng:103.252998352051 },
'bga': { lat:7.1265, lng:-73.1848 },
'bgc': { lat:41.8578, lng:-6.70713 },
'bgf': { lat:4.39847993850708, lng:18.5188007354736 },
'bgi': { lat:13.0746, lng:-59.4925 },
'bgm': { lat:42.20869827, lng:-75.97979736 },
'bgo': { lat:60.29339981, lng:5.218140125 },
'bgr': { lat:44.8073997497559, lng:-68.8281021118164 },
'bgw': { lat:33.2625007629, lng:44.2346000671 },
'bgy': { lat:45.673901, lng:9.70417 },
'bhb': { lat:44.45000076, lng:-68.3615036 },
'bhd': { lat:54.6180992126465, lng:-5.87249994277954 },
'bhe': { lat:-41.5182991027832, lng:173.869995117188 },
'bhh': { lat:19.9843997955322, lng:42.6208992004395 },
'bhi': { lat:-38.725, lng:-62.1693 },
'bhj': { lat:23.2877998352, lng:69.6701965332 },
'bhk': { lat:39.7750015258789, lng:64.4832992553711 },
'bhm': { lat:33.56290054, lng:-86.75350189 },
'bho': { lat:23.2875003815, lng:77.3374023438 },
'bhq': { lat:-32.0013999939, lng:141.472000122 },
'bhs': { lat:-33.4094009399, lng:149.651992798 },
'bhu': { lat:21.752199173, lng:72.1852035522 },
'bhv': { lat:29.3481006622314, lng:71.7180023193359 },
'bhx': { lat:52.4538993835, lng:-1.74802994728 },
'bhy': { lat:21.5394, lng:109.293999 },
'bia': { lat:42.5527000427246, lng:9.48373031616211 },
'bie': { lat:40.3013000488, lng:-96.7540969849 },
'bik': { lat:-1.19001996517181, lng:136.108001708984 },
'bil': { lat:45.8077011108398, lng:-108.542999267578 },
'bio': { lat:43.3011016845703, lng:-2.91060996055603 },
'biq': { lat:43.4683333, lng:-1.5311111 },
'bir': { lat:26.4815006256104, lng:87.2639999389648 },
'bis': { lat:46.7727012634277, lng:-100.746002197266 },
'bja': { lat:36.7120018005, lng:5.06992006302 },
'bjb': { lat:37.4930000305176, lng:57.3082008361816 },
'bjl': { lat:13.3380002975464, lng:-16.6522006988525 },
'bjm': { lat:-3.32401990890503, lng:29.3185005187988 },
'bjr': { lat:11.608099937439, lng:37.3216018676758 },
'bjv': { lat:37.2505989075, lng:27.6643009186 },
'bjx': { lat:20.9935, lng:-101.481003 },
'bjz': { lat:38.891300201416, lng:-6.82133007049561 },
'bkg': { lat:36.532082, lng:-93.200544 },
'bki': { lat:5.93721008300781, lng:116.051002502441 },
'bkk': { lat:13.6810998916626, lng:100.747001647949 },
'bkn': { lat:39.480598, lng:54.366001 },
'bko': { lat:12.5335, lng:-7.94994 },
'bkq': { lat:-24.4277992249, lng:145.429000854 },
'bks': { lat:-3.8637, lng:102.338997 },
'bkw': { lat:37.7873001099, lng:-81.1241989136 },
'bkx': { lat:44.304798, lng:-96.816902 },
'bla': { lat:10.111111, lng:-64.692222 },
'ble': { lat:60.4220008850098, lng:15.5151996612549 },
'blf': { lat:37.2957992553711, lng:-81.2077026367188 },
'bli': { lat:48.7928009033203, lng:-122.53800201416 },
'blj': { lat:35.7521018982, lng:6.3085899353 },
'blk': { lat:53.7717018127441, lng:-3.02860999107361 },
'bll': { lat:55.7402992249, lng:9.15178012848 },
'blq': { lat:44.5354, lng:11.2887 },
'blr': { lat:13.1979, lng:77.706299 },
'blt': { lat:-23.603099822998, lng:148.807006835938 },
'blv': { lat:38.5452, lng:-89.835197 },
'blw': { lat:4.766976, lng:45.2388 },
'blz': { lat:-15.6791000366211, lng:34.9739990234375 },
'bma': { lat:59.3544006347656, lng:17.9416999816895 },
'bme': { lat:-17.9447002410889, lng:122.232002258301 },
'bmi': { lat:40.47710037, lng:-88.91590118 },
'bmo': { lat:24.2689990997314, lng:97.2462005615234 },
'bmu': { lat:-8.5396499633789, lng:118.68699645996 },
'bmv': { lat:12.668299675, lng:108.120002747 },
'bmy': { lat:-19.7206001281738, lng:163.660995483398 },
'bna': { lat:36.1245002746582, lng:-86.6781997680664 },
'bnd': { lat:27.2182998657227, lng:56.377799987793 },
'bne': { lat:-27.3841991424561, lng:153.117004394531 },
'bni': { lat:6.31697988510132, lng:5.59950017929077 },
'bnk': { lat:-28.8339004517, lng:153.56199646 },
'bnp': { lat:32.9729, lng:70.527901 },
'bns': { lat:8.615, lng:-70.21416667 },
'bnx': { lat:44.9413986206055, lng:17.2975006103516 },
'bob': { lat:-16.4444007873535, lng:-151.751007080078 },
'boc': { lat:9.34084987640381, lng:-82.2508010864258 },
'bod': { lat:44.8283, lng:-0.715556 },
'bog': { lat:4.70159, lng:-74.1469 },
'boh': { lat:50.7799987792969, lng:-1.84249997138977 },
'boi': { lat:43.5644, lng:-116.223 },
'boj': { lat:42.5695991516113, lng:27.5151996612549 },
'bom': { lat:19.0886993408, lng:72.8678970337 },
'bon': { lat:12.131, lng:-68.268501 },
'boo': { lat:67.2692031860352, lng:14.3653001785278 },
'bos': { lat:42.36429977, lng:-71.00520325 },
'boy': { lat:11.1600999832153, lng:-4.33096981048584 },
'bpn': { lat:-1.26827001572, lng:116.893997192 },
'bps': { lat:-16.438601, lng:-39.080898 },
'bpt': { lat:29.9507999420166, lng:-94.0206985473633 },
'bpx': { lat:30.5536003112793, lng:97.1082992553711 },
'bqa': { lat:15.729309, lng:121.500034 },
'bqg': { lat:52.38, lng:140.448 },
'bqj': { lat:67.648002624512, lng:134.69500732422 },
'bqk': { lat:31.2588005065918, lng:-81.4664993286133 },
'bqn': { lat:18.4948997497559, lng:-67.1294021606445 },
'bqs': { lat:50.4253997802734, lng:127.412002563477 },
'bqt': { lat:52.108299, lng:23.8981 },
'brc': { lat:-41.151199, lng:-71.157501 },
'brd': { lat:46.39830017, lng:-94.13809967 },
'bre': { lat:53.0475006104, lng:8.78666973114 },
'bri': { lat:41.138901, lng:16.760599 },
'brl': { lat:40.7831993103027, lng:-91.1255035400391 },
'brm': { lat:10.0427465438843, lng:-69.3586196899414 },
'brn': { lat:46.914100647, lng:7.49714994431 },
'bro': { lat:25.9067993164063, lng:-97.4259033203125 },
'brq': { lat:49.1512985229492, lng:16.6944007873535 },
'brs': { lat:51.382702, lng:-2.71909 },
'bru': { lat:50.9014015198, lng:4.48443984985 },
'brw': { lat:71.285402, lng:-156.766008 },
'brx': { lat:18.2514991760254, lng:-71.1203994750977 },
'bsa': { lat:11.2753000259399, lng:49.1493988037109 },
'bsb': { lat:-15.869167, lng:-47.920834 },
'bsg': { lat:1.90547001361847, lng:9.80568027496338 },
'bsk': { lat:34.7933006287, lng:5.73823022842 },
'bsl': { lat:47.59, lng:7.529167 },
'bso': { lat:20.4513, lng:121.980003 },
'bsr': { lat:30.5491008758545, lng:47.6621017456055 },
'bsx': { lat:16.815201, lng:94.7799 },
'btc': { lat:7.70576, lng:81.678802 },
'bth': { lat:1.12102997303, lng:104.119003296 },
'btj': { lat:5.52287202401, lng:95.4206371307 },
'btk': { lat:56.3706016540527, lng:101.697998046875 },
'btm': { lat:45.9547996520996, lng:-112.497001647949 },
'btr': { lat:30.533199, lng:-91.149597 },
'bts': { lat:48.1702003479004, lng:17.2126998901367 },
'btu': { lat:3.12385010719, lng:113.019996643 },
'btv': { lat:44.4719009399, lng:-73.1532974243 },
'bua': { lat:-5.4223198890686, lng:154.673004150391 },
'buc': { lat:-17.7486000061035, lng:139.533996582031 },
'bud': { lat:47.42976, lng:19.261093 },
'buf': { lat:42.94049835, lng:-78.73220062 },
'bun': { lat:3.81963, lng:-76.9898 },
'buo': { lat:9.5275, lng:45.5549 },
'buq': { lat:-20.017401, lng:28.617901 },
'bur': { lat:34.2006988525391, lng:-118.359001159668 },
'bus': { lat:41.6102981567, lng:41.5997009277 },
'but': { lat:27.5622, lng:90.7471 },
'buz': { lat:28.9447994232, lng:50.8345985413 },
'bva': { lat:49.4543991088867, lng:2.11278009414673 },
'bvb': { lat:2.84138894081, lng:-60.6922225952 },
'bve': { lat:45.039722, lng:1.485556 },
'bvh': { lat:-12.694399833679, lng:-60.098300933838 },
'bwa': { lat:27.505685, lng:83.416293 },
'bwe': { lat:52.319199, lng:10.5561 },
'bwi': { lat:39.1754, lng:-76.668297 },
'bwk': { lat:43.285701751709, lng:16.6797008514404 },
'bwn': { lat:4.94420003890991, lng:114.928001403809 },
'bwo': { lat:51.8582992554, lng:47.7456016541 },
'bwt': { lat:-40.9989013671875, lng:145.731002807617 },
'bwx': { lat:-8.31015, lng:114.3401 },
'bxr': { lat:29.0841999053955, lng:58.4500007629395 },
'bxu': { lat:8.9515, lng:125.4788 },
'byk': { lat:7.73880004882813, lng:-5.07366991043091 },
'bym': { lat:20.3964004516602, lng:-76.6213989257813 },
'byn': { lat:46.1632995605469, lng:100.704002380371 },
'byo': { lat:-21.2473, lng:-56.4525 },
'bze': { lat:17.5391006469727, lng:-88.3081970214844 },
'bzg': { lat:53.0968017578, lng:17.9776992798 },
'bzi': { lat:39.6193008422852, lng:27.9260005950928 },
'bzk': { lat:53.214199, lng:34.176399 },
'bzl': { lat:22.8010005950928, lng:90.3012008666992 },
'bzn': { lat:45.77750015, lng:-111.1529999 },
'bzo': { lat:46.460201, lng:11.3264 },
'bzr': { lat:43.3235015869141, lng:3.35389995574951 },
'bzv': { lat:-4.25169992446899, lng:15.2530002593994 },
'bzx': { lat:31.73842, lng:106.644872 },
'cab': { lat:-5.59699010848999, lng:12.1884002685547 },
'cac': { lat:-25.0002994537, lng:-53.5008010864 },
'cae': { lat:33.9388008117676, lng:-81.119499206543 },
'cag': { lat:39.251499, lng:9.05428 },
'cah': { lat:9.177667, lng:105.177778 },
'cai': { lat:30.1219005584717, lng:31.4055995941162 },
'cak': { lat:40.9160995483398, lng:-81.4421997070313 },
'cal': { lat:55.437198638916, lng:-5.6863899230957 },
'can': { lat:23.3924007415772, lng:113.299003601074 },
'cat': { lat:38.724998, lng:-9.35523 },
'caw': { lat:-21.698299408, lng:-41.301700592 },
'cay': { lat:4.81980991364, lng:-52.3604011536 },
'caz': { lat:-31.5382995605469, lng:145.794006347656 },
'cbb': { lat:-17.4211006164551, lng:-66.1771011352539 },
'cbh': { lat:31.6457004547119, lng:-2.26986002922058 },
'cbo': { lat:7.1652398109436, lng:124.209999084473 },
'cbq': { lat:4.97601985931397, lng:8.34720039367676 },
'cbr': { lat:-35.3069000244141, lng:149.195007324219 },
'cbt': { lat:-12.4792, lng:13.4869 },
'ccc': { lat:22.4610004425, lng:-78.3283996582 },
'ccf': { lat:43.2159996032715, lng:2.30631995201111 },
'ccj': { lat:11.1367998123, lng:75.9552993774 },
'cck': { lat:-12.1883001328, lng:96.8339004517 },
'ccm': { lat:-28.7244434357, lng:-49.4213905334 },
'ccp': { lat:-36.772701, lng:-73.063103 },
'ccs': { lat:10.601194, lng:-66.991222 },
'ccu': { lat:22.6546993255615, lng:88.4467010498047 },
'ccv': { lat:-16.264999, lng:167.923996 },
'cdc': { lat:37.7010002136231, lng:-113.098999023438 },
'cde': { lat:41.1225, lng:118.073889 },
'cdg': { lat:49.012798, lng:2.55 },
'cdp': { lat:14.51, lng:78.772778 },
'cdt': { lat:40.213889, lng:0.073333 },
'ceb': { lat:10.307499885559, lng:123.97899627686 },
'cec': { lat:41.78020096, lng:-124.2369995 },
'ced': { lat:-32.1305999755859, lng:133.710006713867 },
'cee': { lat:59.273601532, lng:38.0158004761 },
'ceg': { lat:53.1781005859375, lng:-2.97778010368347 },
'cei': { lat:19.952299118, lng:99.8828964233 },
'cek': { lat:55.305801, lng:61.5033 },
'cen': { lat:27.392599105835, lng:-109.833000183105 },
'ceq': { lat:43.542, lng:6.95348 },
'cer': { lat:49.6501007080078, lng:-1.47028005123138 },
'cfc': { lat:-26.78840065, lng:-50.9398002625 },
'cfe': { lat:45.7867012024, lng:3.1691699028 },
'cfg': { lat:22.1499996185303, lng:-80.4141998291016 },
'cfn': { lat:55.0442008972168, lng:-8.34099960327148 },
'cfr': { lat:49.1733016967773, lng:-0.449999988079071 },
'cfs': { lat:-30.320601, lng:153.115997 },
'cfu': { lat:39.6018981933594, lng:19.9116992950439 },
'cgb': { lat:-15.6528997421, lng:-56.1166992188 },
'cgd': { lat:28.9188995361, lng:111.63999939 },
'cgh': { lat:-23.6261100769043, lng:-46.6563873291016 },
'cgi': { lat:37.2252998352051, lng:-89.57080078125 },
'cgk': { lat:-6.1255698204, lng:106.65599823 },
'cgm': { lat:9.253894, lng:124.709115 },
'cgn': { lat:50.8658981323, lng:7.1427397728 },
'cgo': { lat:34.5196990967, lng:113.841003418 },
'cgp': { lat:22.2495994567871, lng:91.8133010864258 },
'cgq': { lat:43.9962005615, lng:125.684997559 },
'cgr': { lat:-20.4687004089, lng:-54.6725006104 },
'cgy': { lat:8.612203, lng:124.456496 },
'cha': { lat:35.0353012084961, lng:-85.2037963867188 },
'chc': { lat:-43.4893989562988, lng:172.531997680664 },
'chg': { lat:41.538101, lng:120.434998 },
'chm': { lat:-9.14960956573486, lng:-78.5238037109375 },
'cho': { lat:38.138599395752, lng:-78.4529037475586 },
'chq': { lat:35.5317001342773, lng:24.1497001647949 },
'chs': { lat:32.89860153, lng:-80.04049683 },
'cht': { lat:-43.810001373291, lng:-176.457000732422 },
'chx': { lat:9.458962, lng:-82.515062 },
'cia': { lat:41.7994, lng:12.5949 },
'cid': { lat:41.8847007751465, lng:-91.7108001708984 },
'cif': { lat:42.2350006103516, lng:118.907997131348 },
'cit': { lat:42.364200592041, lng:69.4788970947266 },
'ciu': { lat:46.2508010864258, lng:-84.4723968505859 },
'cix': { lat:-6.78747987747192, lng:-79.8281021118164 },
'cja': { lat:-7.13918018341064, lng:-78.4894027709961 },
'cjb': { lat:11.029999733, lng:77.0434036255 },
'cjc': { lat:-22.4981994628906, lng:-68.9036026000977 },
'cjj': { lat:36.717008, lng:127.498741 },
'cjl': { lat:35.8866004943848, lng:71.8005981445313 },
'cjn': { lat:-7.719895, lng:108.488995 },
'cjs': { lat:31.636100769043, lng:-106.429000854492 },
'cju': { lat:33.5112991333008, lng:126.49299621582 },
'ckb': { lat:39.2966003418, lng:-80.2281036377 },
'ckg': { lat:29.7192001342773, lng:106.641998291016 },
'ckh': { lat:70.6231002807617, lng:147.901992797852 },
'cks': { lat:-6.11527776718, lng:-50.0013885498 },
'ckw': { lat:-22.3543, lng:119.6426 },
'cky': { lat:9.57689, lng:-13.612 },
'ckz': { lat:40.1376991272, lng:26.4267997742 },
'cle': { lat:41.4117012024, lng:-81.8498001099 },
'clj': { lat:46.785198, lng:23.686199 },
'cll': { lat:30.58860016, lng:-96.36380005 },
'clm': { lat:48.1202011108398, lng:-123.5 },
'clo': { lat:3.54322, lng:-76.3816 },
'clq': { lat:19.277, lng:-103.577002 },
'clt': { lat:35.2140007019043, lng:-80.9430999755859 },
'clv': { lat:-17.725299835205, lng:-48.607498168945 },
'cly': { lat:42.5244444, lng:8.7930556 },
'cma': { lat:-28.0300006866455, lng:145.621994018555 },
'cmb': { lat:7.1807599067688, lng:79.8841018676758 },
'cme': { lat:18.6536998748779, lng:-91.7990036010742 },
'cmf': { lat:45.6380996704102, lng:5.88022994995117 },
'cmg': { lat:-19.0119438171, lng:-57.6713905334 },
'cmh': { lat:39.998001, lng:-82.891899 },
'cmi': { lat:40.03919983, lng:-88.27809906 },
'cmn': { lat:33.3675003051758, lng:-7.58997011184692 },
'cmw': { lat:21.4202995300293, lng:-77.8475036621094 },
'cmx': { lat:47.168399810791, lng:-88.4890975952148 },
'cnb': { lat:-30.9832992553711, lng:148.376007080078 },
'cnd': { lat:44.3622016906738, lng:28.4883003234863 },
'cnf': { lat:-19.6244430541992, lng:-43.9719429016113 },
'cnj': { lat:-20.6686000824, lng:140.503997803 },
'cnl': { lat:57.503502, lng:10.2294 },
'cnm': { lat:32.3375015258789, lng:-104.263000488281 },
'cnn': { lat:11.918614, lng:75.547211 },
'cnp': { lat:70.7431030273, lng:-22.6504993439 },
'cnq': { lat:-27.4455, lng:-58.7619 },
'cns': { lat:-16.885799408, lng:145.755004883 },
'cnx': { lat:18.7667999268, lng:98.962600708 },
'cok': { lat:10.152, lng:76.401901 },
'coo': { lat:6.3572301864624, lng:2.38435006141663 },
'cor': { lat:-31.323601, lng:-64.208 },
'cou': { lat:38.8181, lng:-92.219597 },
'cpc': { lat:-40.075401, lng:-71.137299 },
'cpd': { lat:-29.0400009155273, lng:134.720993041992 },
'cpe': { lat:19.8167991638, lng:-90.5002975464 },
'cph': { lat:55.617900848389, lng:12.656000137329 },
'cpo': { lat:-27.2611999512, lng:-70.7791976929 },
'cpr': { lat:42.908001, lng:-106.463997 },
'cpt': { lat:-33.9648017883, lng:18.6016998291 },
'cpv': { lat:-7.26992, lng:-35.8964 },
'crc': { lat:4.75818, lng:-75.9557 },
'crd': { lat:-45.7853, lng:-67.4655 },
'cri': { lat:22.7456, lng:-74.182404 },
'crk': { lat:15.186, lng:120.559998 },
'crl': { lat:50.459202, lng:4.45382 },
'crm': { lat:12.5024003982544, lng:124.636001586914 },
'crp': { lat:27.7703990936279, lng:-97.5011978149414 },
'crv': { lat:38.9972, lng:17.0802 },
'crw': { lat:38.3731002807617, lng:-81.5932006835938 },
'crz': { lat:39.0833015441895, lng:63.6133003234863 },
'csg': { lat:32.516300201416, lng:-84.9389038085938 },
'csh': { lat:65.0299987793, lng:35.7333335876 },
'csk': { lat:12.39533, lng:-16.748 },
'csx': { lat:28.1891994476, lng:113.220001221 },
'csy': { lat:56.0903015136719, lng:47.3473014831543 },
'cta': { lat:37.466801, lng:15.0664 },
'ctc': { lat:-28.5956001282, lng:-65.751701355 },
'ctd': { lat:7.98784017562866, lng:-80.4096984863281 },
'ctg': { lat:10.4424, lng:-75.513 },
'ctl': { lat:-26.4132995605, lng:146.261993408 },
'ctm': { lat:18.5046997070313, lng:-88.3267974853516 },
'cts': { lat:42.7751998901367, lng:141.692001342773 },
'ctu': { lat:30.5785007476807, lng:103.946998596191 },
'cua': { lat:25.053801, lng:-111.614998 },
'cuc': { lat:7.92757, lng:-72.5115 },
'cue': { lat:-2.88947, lng:-78.984398 },
'cuf': { lat:44.547001, lng:7.62322 },
'cul': { lat:24.7644996643, lng:-107.474998474 },
'cum': { lat:10.4503326416016, lng:-64.1304702758789 },
'cun': { lat:21.0365009308, lng:-86.8770980835 },
'cup': { lat:10.6600141525269, lng:-63.2616806030273 },
'cuq': { lat:-13.761133, lng:143.113311 },
'cur': { lat:12.1889, lng:-68.959801 },
'cuu': { lat:28.7028999329, lng:-105.964996338 },
'cuz': { lat:-13.5356998444, lng:-71.9387969971 },
'cvg': { lat:39.048801, lng:-84.667801 },
'cvj': { lat:18.8348007202148, lng:-99.2612991333008 },
'cvm': { lat:23.7033004761, lng:-98.9564971924 },
'cvq': { lat:-24.880211, lng:113.67174 },
'cvu': { lat:39.671501, lng:-31.1136 },
'cwb': { lat:-25.5284996033, lng:-49.1758003235 },
'cwc': { lat:48.2593002319336, lng:25.9808006286621 },
'cwl': { lat:51.3967018127441, lng:-3.34332990646362 },
'cxb': { lat:21.4521999359131, lng:91.9638977050781 },
'cxi': { lat:1.98616003990173, lng:-157.350006103516 },
'cxj': { lat:-29.1970996857, lng:-51.1875 },
'cxp': { lat:-7.64506006241, lng:109.033996582 },
'cxr': { lat:11.9982004165649, lng:109.21900177002 },
'cya': { lat:18.2710990905762, lng:-73.7882995605469 },
'cyi': { lat:23.461799621582, lng:120.392997741699 },
'cyo': { lat:21.6165008545, lng:-81.5459976196 },
'cyp': { lat:12.072699546814, lng:124.544998168945 },
'cys': { lat:41.15570068, lng:-104.8119965 },
'cyu': { lat:10.858099937439, lng:121.069000244141 },
'cyw': { lat:20.546, lng:-100.887001 },
'cyx': { lat:68.7406005859375, lng:161.337997436523 },
'cyz': { lat:16.9298992157, lng:121.752998352 },
'cze': { lat:11.4149436950684, lng:-69.6809005737305 },
'czl': { lat:36.2760009765625, lng:6.62038993835449 },
'czm': { lat:20.5223999023438, lng:-86.9255981445313 },
'czs': { lat:-7.59991, lng:-72.769501 },
'czu': { lat:9.33274, lng:-75.2856 },
'czx': { lat:31.919701, lng:119.778999 },
'dab': { lat:29.179899, lng:-81.058098 },
'dac': { lat:23.843347, lng:90.397783 },
'dad': { lat:16.0438995361328, lng:108.198997497559 },
'dal': { lat:32.847099, lng:-96.851799 },
'dam': { lat:33.4114990234375, lng:36.5155982971191 },
'dar': { lat:-6.87811, lng:39.202599 },
'dat': { lat:40.060299, lng:113.482002 },
'dau': { lat:-9.08675956726, lng:143.207992554 },
'dav': { lat:8.39099979400635, lng:-82.4349975585938 },
'dax': { lat:31.1302, lng:107.4295 },
'day': { lat:39.902400970459, lng:-84.2193984985352 },
'dbo': { lat:-32.2167015076, lng:148.574996948 },
'dbq': { lat:42.40200043, lng:-90.70950317 },
'dbv': { lat:42.5614013671875, lng:18.2681999206543 },
'dca': { lat:38.8521, lng:-77.037697 },
'dcf': { lat:15.3367004394531, lng:-61.3922004699707 },
'dcm': { lat:43.5563011169434, lng:2.2891800403595 },
'dcy': { lat:29.323056, lng:100.053333 },
'ddc': { lat:37.7634010314941, lng:-99.9655990600586 },
'ddg': { lat:40.0247, lng:124.286003 },
'dea': { lat:29.9610004425049, lng:70.4859008789063 },
'deb': { lat:47.488899230957, lng:21.6152992248535 },
'dec': { lat:39.8345985412598, lng:-88.8656997680664 },
'ded': { lat:30.189699, lng:78.180298 },
'def': { lat:32.434399, lng:48.397598 },
'del': { lat:28.5665, lng:77.103104 },
'den': { lat:39.861698150635, lng:-104.672996521 },
'dez': { lat:35.2854, lng:40.175999 },
'dfw': { lat:32.896801, lng:-97.038002 },
'dgo': { lat:24.1242008209, lng:-104.527999878 },
'dgt': { lat:9.3337097168, lng:123.300003052 },
'dhn': { lat:31.3213005065918, lng:-85.4496002197266 },
'dib': { lat:27.4839000702, lng:95.0168991089 },
'dig': { lat:27.7936, lng:99.6772 },
'dil': { lat:-8.54640007019, lng:125.526000977 },
'din': { lat:21.3974990845, lng:103.008003235 },
'dir': { lat:9.62469959259033, lng:41.8541984558106 },
'diu': { lat:20.7131004333496, lng:70.9210968017578 },
'diy': { lat:37.893901825, lng:40.2010002136 },
'djb': { lat:-1.63802, lng:103.643997 },
'dje': { lat:33.875, lng:10.7755002975464 },
'djj': { lat:-2.5769500733, lng:140.5160064698 },
'dkr': { lat:14.7397003173828, lng:-17.4902000427246 },
'dla': { lat:4.0060801506, lng:9.71947956085 },
'dlc': { lat:38.9656982421875, lng:121.539001464844 },
'dle': { lat:47.042686, lng:5.435063 },
'dlh': { lat:46.8420982361, lng:-92.1936035156 },
'dli': { lat:11.75, lng:108.366997 },
'dlm': { lat:36.7131004333, lng:28.7924995422 },
'dlr': { lat:45.8783, lng:133.7363 },
'dlr': { lat:45.8783, lng:133.7363 },
'dlu': { lat:25.649401, lng:100.319 },
'dly': { lat:-18.7693996429, lng:169.00100708 },
'dlz': { lat:43.5917015075684, lng:104.430000305176 },
'dmb': { lat:42.8535995483398, lng:71.303596496582 },
'dmd': { lat:-17.9403, lng:138.822006 },
'dme': { lat:55.4087982177734, lng:37.9062995910645 },
'dmk': { lat:13.9125995636, lng:100.607002258 },
'dmm': { lat:26.4712009429932, lng:49.7979011535645 },
'dmu': { lat:25.8838996887, lng:93.7711029053 },
'dnd': { lat:56.4524993896484, lng:-3.02583003044128 },
'dnk': { lat:48.3572006225586, lng:35.1006011962891 },
'dnr': { lat:48.5876998901367, lng:-2.07996010780334 },
'dnz': { lat:37.7855987549, lng:29.7012996674 },
'dog': { lat:19.1539001465, lng:30.4300994873 },
'doh': { lat:25.273056, lng:51.608056 },
'dou': { lat:-22.2019, lng:-54.926601 },
'dpl': { lat:8.60198349877, lng:123.341875076 },
'dpo': { lat:-41.1697006226, lng:146.429992676 },
'dps': { lat:-8.7481698989868, lng:115.16699981689 },
'dpt': { lat:69.392503, lng:139.890012 },
'dqa': { lat:46.7463888889, lng:125.140555556 },
'dqm': { lat:19.501944, lng:57.634167 },
'drs': { lat:51.1328010559082, lng:13.7672004699707 },
'drw': { lat:-12.4146995544434, lng:130.876998901367 },
'dsa': { lat:53.4805378105, lng:-1.01065635681 },
'dse': { lat:11.0825004577637, lng:39.7113990783691 },
'dsk': { lat:31.9094009399414, lng:70.896598815918 },
'dsm': { lat:41.5340003967285, lng:-93.6631011962891 },
'dsn': { lat:39.49, lng:109.861388889 },
'dso': { lat:39.745201, lng:127.473999 },
'dss': { lat:14.67, lng:-17.073333 },
'dtb': { lat:2.25973, lng:98.991898 },
'dtm': { lat:51.5182991028, lng:7.61223983765 },
'dtu': { lat:48.445, lng:126.133 },
'dtw': { lat:42.2123985290527, lng:-83.353401184082 },
'dub': { lat:53.421299, lng:-6.27007 },
'dud': { lat:-45.9281005859375, lng:170.197998046875 },
'due': { lat:-7.40088987350464, lng:20.8185005187988 },
'duj': { lat:41.17829895, lng:-78.8986969 },
'dum': { lat:1.60919, lng:101.433998 },
'dur': { lat:-29.6144444444, lng:31.1197222222 },
'dus': { lat:51.289501, lng:6.76678 },
'dvo': { lat:7.1255202293396, lng:125.646003723145 },
'dwc': { lat:24.896356, lng:55.161389 },
'dwd': { lat:24.4499, lng:44.121201 },
'dxb': { lat:25.2527999878, lng:55.3643989563 },
'dxe': { lat:32.438702, lng:-90.103104 },
'dyg': { lat:29.1028, lng:110.443001 },
'dyr': { lat:64.734902, lng:177.740997 },
'dyu': { lat:38.5433006287, lng:68.8249969482 },
'dza': { lat:-12.8046998977661, lng:45.2811012268066 },
'dzn': { lat:47.708302, lng:67.733299 },
'eae': { lat:-17.0902996063, lng:168.343002319 },
'eam': { lat:17.611400604248, lng:44.4192008972168 },
'ear': { lat:40.72700119, lng:-99.00679779 },
'eas': { lat:43.3564987182617, lng:-1.79060995578766 },
'eau': { lat:44.8657989501953, lng:-91.4842987060547 },
'eba': { lat:42.7603, lng:10.2394 },
'ebb': { lat:0.042386, lng:32.443501 },
'ebd': { lat:13.1532001495361, lng:30.2327003479004 },
'ebj': { lat:55.525902, lng:8.5534 },
'ebl': { lat:36.2375984191895, lng:43.9631996154785 },
'ebu': { lat:45.5405998229981, lng:4.29639005661011 },
'ecn': { lat:35.1547012329102, lng:33.4961013793945 },
'ecp': { lat:30.357106, lng:-85.795414 },
'edi': { lat:55.9500007629395, lng:-3.37249994277954 },
'edl': { lat:0.404457986354828, lng:35.238899230957 },
'edo': { lat:39.554599762, lng:27.0137996674 },
'edr': { lat:-14.896451, lng:141.60908 },
'efl': { lat:38.1200981140137, lng:20.5004997253418 },
'egc': { lat:44.8252983093262, lng:0.518611013889313 },
'ege': { lat:39.64260101, lng:-106.9179993 },
'ego': { lat:50.643798828125, lng:36.5900993347168 },
'egs': { lat:65.2833023071289, lng:-14.4013996124268 },
'eie': { lat:58.4742012023926, lng:92.1125030517578 },
'eik': { lat:46.68, lng:38.21 },
'ein': { lat:51.4500999451, lng:5.37452983856 },
'eis': { lat:18.4447994232178, lng:-64.5429992675781 },
'eja': { lat:7.02433, lng:-73.8068 },
'ejh': { lat:26.198600769043, lng:36.4763984680176 },
'ejt': { lat:6.0404, lng:171.9846 },
'eko': { lat:40.8249015808106, lng:-115.791999816895 },
'eks': { lat:49.1903, lng:142.082993 },
'elc': { lat:-12.0193996429, lng:135.570999146 },
'eld': { lat:33.2210006713867, lng:-92.8133010864258 },
'elf': { lat:13.6148996353149, lng:25.3246002197266 },
'elm': { lat:42.1599006652832, lng:-76.8916015625 },
'elp': { lat:31.80719948, lng:-106.3779984 },
'elq': { lat:26.3027992248535, lng:43.7743988037109 },
'els': { lat:-33.0355987549, lng:27.8258991241 },
'elu': { lat:33.5113983154, lng:6.77679014206 },
'ema': { lat:52.8311004639, lng:-1.32806003094 },
'emd': { lat:-23.5674991608, lng:148.179000854 },
'eme': { lat:53.391109, lng:7.2275 },
'ene': { lat:-8.8492898941, lng:121.661003113 },
'enh': { lat:30.3202991486, lng:109.48500061 },
'eni': { lat:11.202399, lng:119.416087 },
'eno': { lat:-27.227366, lng:-55.837495 },
'enu': { lat:6.47426986694336, lng:7.56196022033691 },
'eoh': { lat:6.220549, lng:-75.590582 },
'eoi': { lat:59.190601348877, lng:-2.77221989631653 },
'epl': { lat:48.325001, lng:6.06998 },
'epr': { lat:-33.684399, lng:121.822998 },
'eqs': { lat:-42.908000946, lng:-71.139503479 },
'erc': { lat:39.7102012634, lng:39.5270004272 },
'erf': { lat:50.9798011779785, lng:10.9581003189087 },
'erh': { lat:31.9475002289, lng:-4.39833021164 },
'eri': { lat:42.0831270134, lng:-80.1738667488 },
'ers': { lat:-22.6121997833252, lng:17.0804004669189 },
'erz': { lat:39.9565010071, lng:41.1702003479 },
'esb': { lat:40.1281013489, lng:32.995098114 },
'esd': { lat:48.7081985474, lng:-122.910003662 },
'ese': { lat:31.7953, lng:-116.602997 },
'esl': { lat:46.3739013671875, lng:44.3308982849121 },
'esm': { lat:0.978519022464752, lng:-79.6266021728516 },
'esr': { lat:-26.3111000061035, lng:-69.7651977539063 },
'etm': { lat:29.723694, lng:35.011416 },
'etr': { lat:-3.441986, lng:-79.996957 },
'etz': { lat:48.9821014404, lng:6.25131988525 },
'eua': { lat:-21.3782997131, lng:-174.957992554 },
'eug': { lat:44.1245994567871, lng:-123.21199798584 },
'eun': { lat:27.151699, lng:-13.2192 },
'eve': { lat:68.491302490234, lng:16.678100585938 },
'evg': { lat:62.0477981567383, lng:14.4229001998901 },
'evn': { lat:40.1473007202, lng:44.3959007263 },
'evv': { lat:38.0369987488, lng:-87.5324020386 },
'ewb': { lat:41.6761016845703, lng:-70.956901550293 },
'ewn': { lat:35.0730018616, lng:-77.0429000854 },
'ewr': { lat:40.6925010681152, lng:-74.168701171875 },
'ext': { lat:50.7344017028809, lng:-3.41388988494873 },
'eyp': { lat:5.31911, lng:-72.384 },
'eyw': { lat:24.5561008453369, lng:-81.7595977783203 },
'eze': { lat:-34.8222, lng:-58.5358 },
'ezs': { lat:38.6068992615, lng:39.2914009094 },
'fae': { lat:62.0635986328125, lng:-7.27721977233887 },
'fai': { lat:64.81510162, lng:-147.8560028 },
'fao': { lat:37.0144004822, lng:-7.96590995789 },
'far': { lat:46.9207000732422, lng:-96.815803527832 },
'fat': { lat:36.776199, lng:-119.718002 },
'fay': { lat:34.9911994934082, lng:-78.8803024291992 },
'fbm': { lat:-11.5913000107, lng:27.5308990479 },
'fca': { lat:48.3105010986328, lng:-114.255996704102 },
'fco': { lat:41.8002778, lng:12.2388889 },
'fde': { lat:61.391101837158, lng:5.7569398880005 },
'fdf': { lat:14.5909996032715, lng:-61.0032005310059 },
'fdh': { lat:47.6712989807, lng:9.51148986816 },
'fdu': { lat:-3.31132006645203, lng:17.3817005157471 },
'fec': { lat:-12.2003, lng:-38.906799 },
'feg': { lat:40.3587989807, lng:71.7450027466 },
'fen': { lat:-3.85493, lng:-32.423302 },
'fez': { lat:33.9272994995, lng:-4.97796010971 },
'fhu': { lat:31.587383, lng:-110.348225 },
'fih': { lat:-4.38575, lng:15.4446 },
'fjr': { lat:25.1121997833252, lng:56.3240013122559 },
'fkb': { lat:48.7793998718, lng:8.08049964905 },
'fki': { lat:0.481638997793, lng:25.3379993439 },
'fks': { lat:37.2274017333984, lng:140.430999755859 },
'fla': { lat:1.58919, lng:-75.5644 },
'flg': { lat:35.13850021, lng:-111.6709976 },
'fll': { lat:26.072599, lng:-80.152702 },
'fln': { lat:-27.6702785491943, lng:-48.5525016784668 },
'flo': { lat:34.1853981018066, lng:-79.7238998413086 },
'flr': { lat:43.810001, lng:11.2051 },
'flw': { lat:39.4552993774414, lng:-31.1313991546631 },
'flz': { lat:1.55594, lng:98.888901 },
'fma': { lat:-26.2127, lng:-58.2281 },
'fmi': { lat:-5.87555980682373, lng:29.25 },
'fmm': { lat:47.9888000488, lng:10.2395000458 },
'fmo': { lat:52.134601593, lng:7.68483018875 },
'fna': { lat:8.61644, lng:-13.1955 },
'fnc': { lat:32.697899, lng:-16.7745 },
'fni': { lat:43.7574005126953, lng:4.4163498878479 },
'fnj': { lat:39.224098, lng:125.669998 },
'fnt': { lat:42.9654006958008, lng:-83.7435989379883 },
'foa': { lat:60.121725, lng:-2.053202 },
'foc': { lat:25.9351005554199, lng:119.66300201416 },
'fod': { lat:42.55149841, lng:-94.19259644 },
'fog': { lat:41.432899, lng:15.535 },
'foo': { lat:-0.936325013638, lng:134.871994019 },
'for': { lat:-3.77627992630005, lng:-38.532600402832 },
'fpo': { lat:26.5587005615, lng:-78.695602417 },
'fra': { lat:50.033333, lng:8.570556 },
'frd': { lat:48.5219993591, lng:-123.024002075 },
'fre': { lat:-8.1075, lng:159.576996 },
'frl': { lat:44.194801, lng:12.0701 },
'fro': { lat:61.583599090576, lng:5.0247201919556 },
'frs': { lat:16.9137992859, lng:-89.8664016724 },
'fru': { lat:43.0612983704, lng:74.4776000977 },
'frw': { lat:-21.1595993041992, lng:27.4745006561279 },
'fsc': { lat:41.500599, lng:9.09778 },
'fsd': { lat:43.5820007324, lng:-96.741897583 },
'fsm': { lat:35.3366012573242, lng:-94.3674011230469 },
'fsp': { lat:46.7629013061523, lng:-56.1730995178223 },
'fsz': { lat:34.7960434679, lng:138.18775177 },
'fta': { lat:-19.5163993835, lng:170.231994629 },
'fte': { lat:-50.2803, lng:-72.053101 },
'fti': { lat:-14.2172, lng:-169.425003 },
'ftu': { lat:-25.0380992889404, lng:46.9561004638672 },
'fue': { lat:28.4526996612549, lng:-13.8638000488281 },
'fug': { lat:32.882157, lng:115.734364 },
'fuj': { lat:32.6663017272949, lng:128.832992553711 },
'fuk': { lat:33.5858993530273, lng:130.45100402832 },
'fun': { lat:-8.525, lng:179.195999 },
'fuo': { lat:23.0832996368, lng:113.069999695 },
'fut': { lat:-14.3114004135, lng:-178.065994263 },
'fwa': { lat:40.97850037, lng:-85.19509888 },
'fyj': { lat:48.199494, lng:134.366447 },
'gae': { lat:33.8768997192383, lng:10.1033000946045 },
'gaf': { lat:34.4220008850098, lng:8.82250022888184 },
'gaj': { lat:38.4118995667, lng:140.371002197 },
'gan': { lat:-0.693342, lng:73.155602 },
'gao': { lat:20.0853004455566, lng:-75.1583023071289 },
'gaq': { lat:16.2483997344971, lng:-0.00545600010082126 },
'gau': { lat:26.1061000823975, lng:91.5858993530273 },
'gay': { lat:24.7443008422852, lng:84.9512023925781 },
'gbb': { lat:40.826667, lng:47.7125 },
'gbe': { lat:-24.555201, lng:25.9182 },
'gcc': { lat:44.3488998413, lng:-105.539001465 },
'gci': { lat:49.435001373291, lng:-2.60196995735168 },
'gck': { lat:37.9275016785, lng:-100.723999023 },
'gcm': { lat:19.2928009033, lng:-81.3576965332 },
'gcn': { lat:35.9524002075195, lng:-112.147003173828 },
'gdl': { lat:20.5217990875244, lng:-103.310997009277 },
'gdn': { lat:54.3776016235352, lng:18.4661998748779 },
'gdq': { lat:12.5199003219605, lng:37.4339981079102 },
'gdt': { lat:21.4444999694824, lng:-71.1423034667969 },
'gdx': { lat:59.9109992980957, lng:150.720001220703 },
'gdz': { lat:44.5820926295, lng:38.0124807358 },
'gea': { lat:-22.25830078125, lng:166.473007202148 },
'geg': { lat:47.6198997497559, lng:-117.533996582031 },
'gel': { lat:-28.2817, lng:-54.169102 },
'geo': { lat:6.4985499382019, lng:-58.2541007995606 },
'ger': { lat:21.8346996307373, lng:-82.7837982177734 },
'ges': { lat:6.05800008774, lng:125.096000671 },
'get': { lat:-28.796101, lng:114.707001 },
'gff': { lat:-34.2508010864, lng:146.067001343 },
'gfk': { lat:47.949299, lng:-97.176102 },
'ggg': { lat:32.3839988708496, lng:-94.7115020751953 },
'ggw': { lat:48.212502, lng:-106.614998 },
'gha': { lat:32.3841018676758, lng:3.79411005973816 },
'ght': { lat:25.1455993652, lng:10.1426000595 },
'gib': { lat:36.1511993408, lng:-5.34965991974 },
'gig': { lat:-22.8099994659, lng:-43.2505569458 },
'gil': { lat:35.9188003540039, lng:74.3336029052734 },
'gis': { lat:-38.6632995605469, lng:177.977996826172 },
'giz': { lat:16.9011001586914, lng:42.5858001708984 },
'gjl': { lat:36.7951011658, lng:5.87361001968 },
'gjt': { lat:39.1223983765, lng:-108.527000427 },
'gkk': { lat:0.7324, lng:73.4336 },
'gla': { lat:55.871899, lng:-4.43306 },
'glh': { lat:33.4828987121582, lng:-90.9856033325195 },
'glk': { lat:6.78082990646, lng:47.45470047 },
'glt': { lat:-23.869699, lng:151.223007 },
'gma': { lat:3.23536992073, lng:19.7712993622 },
'gmb': { lat:8.12876033782959, lng:34.5630989074707 },
'gme': { lat:52.5270004272461, lng:31.0167007446289 },
'gmi': { lat:-6.27111005783, lng:150.330993652 },
'gmo': { lat:10.2983333333, lng:10.8963888889 },
'gmp': { lat:37.5583, lng:126.791 },
'gmr': { lat:-23.0799007415772, lng:-134.889999389648 },
'gna': { lat:53.6020011901856, lng:24.0538005828857 },
'gnb': { lat:45.3629, lng:5.32937 },
'gnd': { lat:12.0041999816895, lng:-61.7862014770508 },
'gnv': { lat:29.6900997162, lng:-82.2717971802 },
'gny': { lat:37.445663, lng:38.895592 },
'goa': { lat:44.4133, lng:8.8375 },
'goh': { lat:64.19090271, lng:-51.6781005859 },
'goi': { lat:15.3808002472, lng:73.8313980103 },
'goj': { lat:56.230098724365, lng:43.784000396729 },
'gom': { lat:-1.67080998420715, lng:29.2385005950928 },
'gop': { lat:26.7397003174, lng:83.4496994019 },
'gor': { lat:8.1614, lng:35.5529 },
'got': { lat:57.662799835205, lng:12.279800415039 },
'gou': { lat:9.33588981628418, lng:13.3701000213623 },
'gov': { lat:-12.2693996429, lng:136.817993164 },
'gpa': { lat:38.1511, lng:21.4256 },
'gpi': { lat:2.57013, lng:-77.8986 },
'gps': { lat:-0.453758001327515, lng:-90.2658996582031 },
'gpt': { lat:30.4073009490967, lng:-89.0700988769531 },
'grb': { lat:44.4850997924805, lng:-88.1296005249023 },
'gri': { lat:40.9674987792969, lng:-98.3096008300781 },
'grj': { lat:-34.0056, lng:22.378902 },
'grk': { lat:31.067199707, lng:-97.8289031982 },
'gro': { lat:41.901000977, lng:2.7605500221 },
'grq': { lat:53.1197013855, lng:6.57944011688 },
'grr': { lat:42.88079834, lng:-85.52279663 },
'gru': { lat:-23.4355564117432, lng:-46.4730567932129 },
'grv': { lat:43.388302, lng:45.698601 },
'grw': { lat:39.0922012329102, lng:-28.0298004150391 },
'grx': { lat:37.1887016296387, lng:-3.77735996246338 },
'gry': { lat:66.5458, lng:-18.0173 },
'grz': { lat:46.9911003112793, lng:15.4395999908447 },
'gsj': { lat:13.9362001419, lng:-90.8358001709 },
'gso': { lat:36.0978012084961, lng:-79.9373016357422 },
'gsp': { lat:34.8956985474, lng:-82.2189025879 },
'gst': { lat:58.4253006, lng:-135.7070007 },
'gte': { lat:-13.9750003815, lng:136.460006714 },
'gtf': { lat:47.48199844, lng:-111.3710022 },
'gto': { lat:0.63711899519, lng:122.849998474 },
'gtr': { lat:33.4502983093, lng:-88.5914001465 },
'gua': { lat:14.5833, lng:-90.527496 },
'gub': { lat:28.0261, lng:-114.024002 },
'gum': { lat:13.4834003448, lng:144.796005249 },
'gur': { lat:-10.3114995956, lng:150.333999634 },
'guw': { lat:47.1218986511231, lng:51.8213996887207 },
'gva': { lat:46.2380981445313, lng:6.10895013809204 },
'gvr': { lat:-18.89520072937, lng:-41.982200622559 },
'gwd': { lat:25.2332992553711, lng:62.3294982910156 },
'gwl': { lat:26.2933006286621, lng:78.2277984619141 },
'gwt': { lat:54.9132003784, lng:8.34047031403 },
'gwy': { lat:53.3002014160156, lng:-8.94159030914307 },
'gxg': { lat:-7.75450992584229, lng:15.2876996994019 },
'gyd': { lat:40.4674987792969, lng:50.0466995239258 },
'gye': { lat:-2.15741991997, lng:-79.8835983276 },
'gyl': { lat:-16.6369, lng:128.451004 },
'gym': { lat:27.9689998626709, lng:-110.925003051758 },
'gyn': { lat:-16.6319999694824, lng:-49.2206993103027 },
'gzo': { lat:-8.09778022766, lng:156.863998413 },
'gzp': { lat:36.299217, lng:32.300598 },
'gzt': { lat:36.9472007751, lng:37.4786987305 },
'haa': { lat:70.486701965332, lng:22.139699935913 },
'had': { lat:56.6911010742188, lng:12.8201999664307 },
'hah': { lat:-11.5337, lng:43.2719 },
'haj': { lat:52.461101532, lng:9.68507957458 },
'hak': { lat:19.9349002838135, lng:110.458999633789 },
'ham': { lat:53.630401611328, lng:9.9882297515869 },
'han': { lat:21.2212009429932, lng:105.806999206543 },
'has': { lat:27.437901, lng:41.686298 },
'hau': { lat:59.34529876709, lng:5.2083601951599 },
'hav': { lat:22.989200592041, lng:-82.4091033935547 },
'hba': { lat:-42.836101532, lng:147.509994507 },
'hbe': { lat:30.9176998138428, lng:29.6963996887207 },
'hbx': { lat:15.361700058, lng:75.0848999023 },
'hcn': { lat:22.0410995483398, lng:120.730003356934 },
'hdf': { lat:53.8787002563, lng:14.152299881 },
'hdg': { lat:36.5258333333, lng:114.425555556 },
'hds': { lat:-24.3686008453, lng:31.0487003326 },
'hdy': { lat:6.93320989609, lng:100.392997742 },
'hea': { lat:34.2099990844727, lng:62.2282981872559 },
'heh': { lat:20.7469997406006, lng:96.7919998168945 },
'hei': { lat:54.1533317566, lng:8.90166664124 },
'hek': { lat:50.1716209371, lng:127.308883667 },
'hel': { lat:60.3172, lng:24.963301 },
'her': { lat:35.3396987915, lng:25.1802997589 },
'het': { lat:40.851398, lng:111.823997 },
'hfa': { lat:32.8093986511231, lng:35.043098449707 },
'hfe': { lat:31.7800006866455, lng:117.297996520996 },
'hfn': { lat:64.295601, lng:-15.2272 },
'hfs': { lat:60.0200996398926, lng:13.5789003372192 },
'hga': { lat:9.513207, lng:44.082389 },
'hgd': { lat:-20.8150005340576, lng:144.225006103516 },
'hge': { lat:10.462474, lng:-66.092779 },
'hgh': { lat:30.2294998168945, lng:120.43399810791 },
'hgu': { lat:-5.82678985595703, lng:144.296005249023 },
'hhn': { lat:49.9487, lng:7.26389 },
'hhq': { lat:12.6361999512, lng:99.951499939 },
'hib': { lat:47.38660049, lng:-92.83899689 },
'hid': { lat:-10.586400032, lng:142.289993286 },
'hij': { lat:34.4361, lng:132.919006 },
'hin': { lat:35.088591, lng:128.071747 },
'hir': { lat:-9.4280004501343, lng:160.05499267578 },
'hjj': { lat:27.4411111111, lng:109.7 },
'hjr': { lat:24.817199707, lng:79.9186019897 },
'hkd': { lat:41.7700004578, lng:140.822006226 },
'hkg': { lat:22.308901, lng:113.915001 },
'hkk': { lat:-42.7136001586914, lng:170.985000610352 },
'hkn': { lat:-5.46217012405396, lng:150.404998779297 },
'hkt': { lat:8.1132, lng:98.316902 },
'hla': { lat:-25.9384994507, lng:27.9260997772 },
'hld': { lat:49.205002, lng:119.824997 },
'hle': { lat:-15.957725, lng:-5.645943 },
'hlh': { lat:46.195333, lng:122.008333 },
'hln': { lat:46.6068000793457, lng:-111.983001708984 },
'hlp': { lat:-6.26661014556885, lng:106.890998840332 },
'hlz': { lat:-37.8666992188, lng:175.332000732 },
'hma': { lat:61.0284996032715, lng:69.0860977172852 },
'hmb': { lat:26.342778, lng:31.742778 },
'hme': { lat:31.6730003357, lng:6.14043998718 },
'hmi': { lat:42.8414, lng:93.669197 },
'hmo': { lat:29.0958995819, lng:-111.047996521 },
'hmv': { lat:65.806099, lng:15.0828 },
'hna': { lat:39.4286, lng:141.134995 },
'hnd': { lat:35.552299, lng:139.779999 },
'hnh': { lat:58.0961, lng:-135.410111 },
'hnl': { lat:21.32062, lng:-157.924228 },
'hny': { lat:26.9053, lng:112.627998 },
'hod': { lat:14.7530002593994, lng:42.9762992858887 },
'hof': { lat:25.2852993011475, lng:49.4851989746094 },
'hog': { lat:20.7856006622314, lng:-76.3151016235352 },
'hok': { lat:-18.3367004395, lng:130.638000488 },
'hon': { lat:44.3852005004883, lng:-98.2285003662109 },
'hoq': { lat:50.2886123657227, lng:11.8563890457153 },
'hor': { lat:38.5199012756348, lng:-28.7159004211426 },
'hot': { lat:34.4780006408691, lng:-93.0961990356445 },
'hou': { lat:29.64539909, lng:-95.27890015 },
'hov': { lat:62.180000305176, lng:6.0741000175476 },
'hpa': { lat:-19.7770004272461, lng:-174.341003417969 },
'hph': { lat:20.8194007873535, lng:106.724998474121 },
'hpn': { lat:41.0670013427734, lng:-73.7076034545898 },
'hrb': { lat:45.6234016418457, lng:126.25 },
'hre': { lat:-17.931801, lng:31.0928 },
'hrg': { lat:27.1783008575439, lng:33.7994003295898 },
'hri': { lat:6.284467, lng:81.124128 },
'hrk': { lat:49.9248008728027, lng:36.2900009155273 },
'hrl': { lat:26.2285003662109, lng:-97.6544036865234 },
'hrm': { lat:32.9304008483887, lng:3.31153988838196 },
'hro': { lat:36.2615013122559, lng:-93.1547012329102 },
'hsg': { lat:33.1497001648, lng:130.302001953 },
'hsv': { lat:34.637199401855, lng:-86.775100708008 },
'hta': { lat:52.026299, lng:113.306 },
'hti': { lat:-20.3581008911, lng:148.95199585 },
'htn': { lat:37.038501739502, lng:79.8648986816406 },
'hts': { lat:38.36669922, lng:-82.55799866 },
'hty': { lat:36.36277771, lng:36.2822227478 },
'huh': { lat:-16.6872005462647, lng:-151.022003173828 },
'hui': { lat:16.4015007019, lng:107.70300293 },
'hun': { lat:24.023099899292, lng:121.61799621582 },
'huu': { lat:-9.87880992889404, lng:-76.2048034667969 },
'hux': { lat:15.7753, lng:-96.262604 },
'huy': { lat:53.5744018554688, lng:-0.350832998752594 },
'huz': { lat:23.0499992371, lng:114.599998474 },
'hvb': { lat:-25.3188991547, lng:152.880004883 },
'hvd': { lat:47.9541015625, lng:91.6281967163086 },
'hvn': { lat:41.26369858, lng:-72.88680267 },
'hya': { lat:41.66930008, lng:-70.28040314 },
'hyd': { lat:17.231318, lng:78.429855 },
'hyn': { lat:28.5622005462647, lng:121.429000854492 },
'hzk': { lat:65.952301, lng:-17.426001 },
'iad': { lat:38.9445, lng:-77.455803 },
'iah': { lat:29.9843997955322, lng:-95.3414001464844 },
'iam': { lat:28.0515, lng:9.64291 },
'iao': { lat:9.8591, lng:126.014 },
'ias': { lat:47.1785011291504, lng:27.6205997467041 },
'iba': { lat:7.36246013641357, lng:3.97832989692688 },
'ibb': { lat:-0.942628026009, lng:-90.9530029297 },
'ibe': { lat:4.42161, lng:-75.1333 },
'ibr': { lat:36.181099, lng:140.414993 },
'ibz': { lat:38.8728981018, lng:1.37311995029 },
'icc': { lat:10.794432, lng:-63.98159 },
'icn': { lat:37.4691009521484, lng:126.450996398926 },
'ict': { lat:37.649899, lng:-97.433098 },
'ida': { lat:43.514599, lng:-112.070999 },
'idr': { lat:22.7217998505, lng:75.8011016846 },
'idy': { lat:46.7186012268066, lng:-2.39110994338989 },
'ieg': { lat:52.1385002136, lng:15.7986001968 },
'iev': { lat:50.40194, lng:30.45194 },
'ifj': { lat:66.0580978393555, lng:-23.1352996826172 },
'ifn': { lat:32.7508010864258, lng:51.8613014221191 },
'ifo': { lat:48.8842010498047, lng:24.6861000061035 },
'ifp': { lat:35.15739822, lng:-114.5599976 },
'igd': { lat:39.9766273499, lng:43.8766479492 },
'igm': { lat:35.2594985961914, lng:-113.938003540039 },
'igr': { lat:-25.737301, lng:-54.4734 },
'igt': { lat:43.3222999573, lng:45.0125999451 },
'igu': { lat:-25.6002788543701, lng:-54.4850006103516 },
'ijk': { lat:56.8280982971191, lng:53.4575004577637 },
'ika': { lat:35.4160995483398, lng:51.1521987915039 },
'iki': { lat:33.7490005493, lng:129.785003662 },
'iks': { lat:71.697700500488, lng:128.90299987793 },
'ikt': { lat:52.268001556396, lng:104.38899993896 },
'iku': { lat:42.58792, lng:76.713046 },
'ild': { lat:41.728185, lng:0.535023 },
'ilf': { lat:56.0614013672, lng:-95.613899231 },
'ilg': { lat:39.67869949, lng:-75.60649872 },
'ilm': { lat:34.2705993652344, lng:-77.9026031494141 },
'ilo': { lat:10.833017, lng:122.493358 },
'ilp': { lat:-22.5888996124268, lng:167.455993652344 },
'ilr': { lat:8.44021034240723, lng:4.49391984939575 },
'ily': { lat:55.6819000244141, lng:-6.25666999816895 },
'ilz': { lat:49.2314987183, lng:18.6135005951 },
'imf': { lat:24.7600002289, lng:93.896697998 },
'imp': { lat:-5.53129, lng:-47.459999 },
'inc': { lat:38.322758, lng:106.393214 },
'ind': { lat:39.7173, lng:-86.294403 },
'inh': { lat:-23.8763999938965, lng:35.4085006713867 },
'ini': { lat:43.337299, lng:21.853701 },
'inl': { lat:48.5662002563477, lng:-93.4030990600586 },
'inn': { lat:47.260201, lng:11.344 },
'inu': { lat:-0.547458, lng:166.919006 },
'inv': { lat:57.5424995422363, lng:-4.0475001335144 },
'inz': { lat:27.2509994507, lng:2.51202011108 },
'ioa': { lat:39.6963996887207, lng:20.8225002288818 },
'iom': { lat:54.0833015441895, lng:-4.6238899230957 },
'ios': { lat:-14.815999984741, lng:-39.033199310303 },
'ipa': { lat:-18.856389, lng:169.283333 },
'ipc': { lat:-27.1648006439, lng:-109.42199707 },
'iph': { lat:4.56796979904175, lng:101.092002868652 },
'ipi': { lat:0.861925, lng:-77.6718 },
'ipn': { lat:-19.470699310303, lng:-42.487598419189 },
'ipt': { lat:41.2417984008789, lng:-76.9210968017578 },
'iqq': { lat:-20.5352001190186, lng:-70.1812973022461 },
'iqt': { lat:-3.78473997116089, lng:-73.3087997436523 },
'ira': { lat:-10.4497003555, lng:161.897994995 },
'irg': { lat:-12.7869, lng:143.304993 },
'irj': { lat:-29.3815994263, lng:-66.7957992554 },
'irk': { lat:40.0934982299805, lng:-92.5448989868164 },
'irp': { lat:2.82761001586914, lng:27.5883007049561 },
'irz': { lat:-0.3786, lng:-64.9923 },
'isa': { lat:-20.6639003754, lng:139.488998413 },
'isb': { lat:33.549, lng:72.82566 },
'isc': { lat:49.9132995605469, lng:-6.29166984558106 },
'ise': { lat:37.8554000854, lng:30.3684005737 },
'isg': { lat:24.396389, lng:124.245 },
'isk': { lat:20.119101, lng:73.912903 },
'isp': { lat:40.79520035, lng:-73.10019684 },
'ist': { lat:41.261297, lng:28.741951 },
'isu': { lat:35.5617485046, lng:45.3167381287 },
'itb': { lat:-4.2423400878906, lng:-56.000701904297 },
'ith': { lat:42.4910011291504, lng:-76.4583969116211 },
'itm': { lat:34.7854995727539, lng:135.438003540039 },
'ito': { lat:19.721399307251, lng:-155.048004150391 },
'itu': { lat:45.256389, lng:147.95549 },
'iue': { lat:-19.0790309906006, lng:-169.925598144531 },
'ivc': { lat:-46.4123992919922, lng:168.313003540039 },
'ivl': { lat:68.607299804688, lng:27.405300140381 },
'iwa': { lat:56.9393997192383, lng:40.9407997131348 },
'iwj': { lat:34.676399231, lng:131.789993286 },
'iwk': { lat:34.146333, lng:132.247238 },
'ixa': { lat:23.8869991302, lng:91.2404022217 },
'ixb': { lat:26.6812000274658, lng:88.3285980224609 },
'ixc': { lat:30.6735000610352, lng:76.7884979248047 },
'ixd': { lat:25.4401, lng:81.733902 },
'ixe': { lat:12.9612998962, lng:74.8900985718 },
'ixg': { lat:15.8592996597, lng:74.6183013916 },
'ixi': { lat:27.2954998016357, lng:94.0976028442383 },
'ixj': { lat:32.689098, lng:74.837402 },
'ixl': { lat:34.1358985901, lng:77.5465011597 },
'ixm': { lat:9.83450984955, lng:78.0933990479 },
'ixp': { lat:32.233611, lng:75.634444 },
'ixr': { lat:23.3143005371, lng:85.3217010498 },
'ixs': { lat:24.9129009247, lng:92.9786987305 },
'ixu': { lat:19.862699508667, lng:75.3981018066406 },
'ixy': { lat:23.1127, lng:70.100304 },
'ixz': { lat:11.6412000656128, lng:92.7296981811523 },
'iza': { lat:-21.513056, lng:-43.173058 },
'iza': { lat:-21.513086, lng:-43.173069 },
'izo': { lat:35.413601, lng:132.889999 },
'izt': { lat:16.449301, lng:-95.093697 },
'jac': { lat:43.6072998046875, lng:-110.737998962402 },
'jae': { lat:-5.59248, lng:-78.774002 },
'jaf': { lat:9.79232978820801, lng:80.0700988769531 },
'jai': { lat:26.8242, lng:75.812202 },
'jak': { lat:18.2411003112793, lng:-72.5185012817383 },
'jal': { lat:19.4750995636, lng:-96.7975006104 },
'jan': { lat:32.3111991882, lng:-90.0758972168 },
'jau': { lat:-11.7831001282, lng:-75.4733963013 },
'jav': { lat:69.2432022095, lng:-51.0570983887 },
'jax': { lat:30.4941005706787, lng:-81.6878967285156 },
'jbb': { lat:-8.238056, lng:113.694439 },
'jbq': { lat:18.5725002288818, lng:-69.9856033325195 },
'jbr': { lat:35.8316993713379, lng:-90.6464004516602 },
'jck': { lat:-20.6683006286621, lng:141.723007202148 },
'jdf': { lat:-21.7915000915527, lng:-43.3867988586426 },
'jdh': { lat:26.2511005401611, lng:73.0488967895508 },
'jdo': { lat:-7.21895980835, lng:-39.2700996399 },
'jdz': { lat:29.3386001587, lng:117.176002502 },
'jed': { lat:21.6796, lng:39.156502 },
'jeg': { lat:68.7218017578, lng:-52.7846984863 },
'jer': { lat:49.2079010009766, lng:-2.1955099105835 },
'jfk': { lat:40.639801, lng:-73.7789 },
'jfn': { lat:41.7779998779, lng:-80.6955032349 },
'jfr': { lat:62.0147361755, lng:-49.6709365845 },
'jga': { lat:22.4654998779297, lng:70.0126037597656 },
'jgn': { lat:39.856899, lng:98.3414 },
'jgs': { lat:26.8568992615, lng:114.736999512 },
'jhb': { lat:1.64131, lng:103.669998 },
'jhg': { lat:21.9738998413086, lng:100.76000213623 },
'jhm': { lat:20.9629001617432, lng:-156.673004150391 },
'jhs': { lat:66.951302, lng:-53.729301 },
'jib': { lat:11.5473003387451, lng:43.1595001220703 },
'jic': { lat:38.5422222222, lng:102.348333333 },
'jij': { lat:9.3325, lng:42.9121 },
'jim': { lat:7.66609001159668, lng:36.8166007995606 },
'jiu': { lat:29.476944, lng:115.801111 },
'jjd': { lat:-2.906425, lng:-40.357338 },
'jjg': { lat:-28.6753, lng:-49.0596 },
'jjn': { lat:24.7964, lng:118.589996 },
'jkg': { lat:57.7575988769531, lng:14.068699836731 },
'jkh': { lat:38.3432006835938, lng:26.1406002044678 },
'jkr': { lat:26.7087993622, lng:85.9224014282 },
'jln': { lat:37.151798248291, lng:-94.4982986450195 },
'jlr': { lat:23.1777992248535, lng:80.052001953125 },
'jms': { lat:46.92969894, lng:-98.67819977 },
'jmu': { lat:46.8433990479, lng:130.464996338 },
'jnb': { lat:-26.1392, lng:28.246 },
'jng': { lat:35.292778, lng:116.346667 },
'jnu': { lat:58.3549995422363, lng:-134.57600402832 },
'jnz': { lat:41.1013984680176, lng:121.061996459961 },
'joe': { lat:62.662899, lng:29.6075 },
'jog': { lat:-7.78818, lng:110.431999 },
'joi': { lat:-26.2245006561279, lng:-48.7974014282227 },
'jok': { lat:56.7005996704102, lng:47.9047012329102 },
'jol': { lat:6.05366992950439, lng:121.011001586914 },
'jos': { lat:9.63982963562012, lng:8.86905002593994 },
'jpa': { lat:-7.14583301544, lng:-34.9486122131 },
'jpr': { lat:-10.8708000183, lng:-61.8465003967 },
'jqa': { lat:70.7341995239, lng:-52.6962013245 },
'jrh': { lat:26.7315006256, lng:94.1754989624 },
'jro': { lat:-3.42941, lng:37.074501 },
'jsh': { lat:35.2160987854004, lng:26.1012992858887 },
'jsi': { lat:39.1771011352539, lng:23.5037002563477 },
'jsj': { lat:47.11, lng:132.660278 },
'jsr': { lat:23.1837997436523, lng:89.1607971191406 },
'jst': { lat:40.3161010742188, lng:-78.8339004516602 },
'jsu': { lat:65.4124984741, lng:-52.9393997192 },
'jtc': { lat:-22.160755, lng:-49.070325 },
'jtr': { lat:36.3992004394531, lng:25.4792995452881 },
'jub': { lat:4.87201023102, lng:31.6011009216 },
'juj': { lat:-24.392799, lng:-65.097801 },
'jul': { lat:-15.4671001434326, lng:-70.158203125 },
'juv': { lat:72.7901992798, lng:-56.1305999756 },
'juz': { lat:28.965799, lng:118.899002 },
'jxa': { lat:45.293, lng:131.193 },
'jyv': { lat:62.399502, lng:25.678301 },
'kac': { lat:37.020599, lng:41.191399 },
'kad': { lat:10.6960000991821, lng:7.32010984420776 },
'kaj': { lat:64.2855, lng:27.6924 },
'kan': { lat:12.0476, lng:8.52462 },
'kao': { lat:65.987602, lng:29.239401 },
'kat': { lat:-35.0699996948242, lng:173.285003662109 },
'kaw': { lat:10.0493001937866, lng:98.5380020141602 },
'kax': { lat:-27.692813, lng:114.259169 },
'kbl': { lat:34.565899, lng:69.212303 },
'kbp': { lat:50.3450012207031, lng:30.8946990966797 },
'kbr': { lat:6.16685009002686, lng:102.292999267578 },
'kbt': { lat:8.90056037902832, lng:170.843994140625 },
'kbv': { lat:8.09912014008, lng:98.9861984253 },
'kca': { lat:41.677856, lng:82.872917 },
'kch': { lat:1.48469996452332, lng:110.34700012207 },
'kcm': { lat:37.5388259888, lng:36.9535217285 },
'kct': { lat:5.99368000030518, lng:80.3202972412109 },
'kcz': { lat:33.546101, lng:133.669006 },
'kdd': { lat:27.790599823, lng:66.6473007202 },
'kdi': { lat:-4.08161020278931, lng:122.417999267578 },
'kdm': { lat:0.488130986690521, lng:72.9969024658203 },
'kdr': { lat:-6.19217, lng:149.54783 },
'kef': { lat:63.985001, lng:-22.6056 },
'kej': { lat:55.2700996398926, lng:86.1072006225586 },
'kel': { lat:54.3794441223145, lng:10.1452779769897 },
'kem': { lat:65.778701782227, lng:24.582099914551 },
'kep': { lat:28.1035995483398, lng:81.6669998168945 },
'ker': { lat:30.2744007111, lng:56.9510993958 },
'kga': { lat:-5.90005016327, lng:22.4692001343 },
'kgc': { lat:-35.7139015197754, lng:137.52099609375 },
'kgd': { lat:54.8899993896484, lng:20.5925998687744 },
'kgf': { lat:49.6707992553711, lng:73.3343963623047 },
'kgi': { lat:-30.7894001007, lng:121.461997986 },
'kgl': { lat:-1.96863, lng:30.1395 },
'kgp': { lat:62.1903991699219, lng:74.5337982177734 },
'kgs': { lat:36.7933006286621, lng:27.0916996002197 },
'kgt': { lat:30.142464, lng:101.73872 },
'khd': { lat:33.4353981018066, lng:48.282901763916 },
'khe': { lat:46.6758, lng:32.506401 },
'khg': { lat:39.5429000854, lng:76.0199966431 },
'khh': { lat:22.5771007537842, lng:120.349998474121 },
'khi': { lat:24.9065, lng:67.160797 },
'khn': { lat:28.8649997711182, lng:115.900001525879 },
'khv': { lat:48.52799987793, lng:135.18800354004 },
'kid': { lat:55.9216995239258, lng:14.0854997634888 },
'kie': { lat:-6.305417, lng:155.728139 },
'kih': { lat:26.5261993408, lng:53.9802017212 },
'kij': { lat:37.9558982849, lng:139.121002197 },
'kim': { lat:-28.8027992249, lng:24.7651996613 },
'kin': { lat:17.9356994628906, lng:-76.7874984741211 },
'kio': { lat:5.644515, lng:169.119507 },
'kir': { lat:52.1809005737305, lng:-9.52377986907959 },
'kis': { lat:-0.0861390009522438, lng:34.7289009094238 },
'kiv': { lat:46.9277000427246, lng:28.9309997558594 },
'kix': { lat:34.4272994995117, lng:135.244003295898 },
'kja': { lat:56.172901, lng:92.493301 },
'kjh': { lat:26.972, lng:107.988 },
'kji': { lat:48.2223, lng:86.9959 },
'kkc': { lat:16.4666004181, lng:102.783996582 },
'kke': { lat:-35.2627983093262, lng:173.912002563477 },
'kkj': { lat:33.845901, lng:131.035004 },
'kks': { lat:33.895302, lng:51.577 },
'kkw': { lat:-5.03576993942261, lng:18.7856006622314 },
'kkx': { lat:28.3213005066, lng:129.927993774 },
'klh': { lat:16.6646995544, lng:74.2893981934 },
'klo': { lat:11.679400444, lng:122.375999451 },
'klr': { lat:56.6855010986328, lng:16.2875995635986 },
'klu': { lat:46.642502, lng:14.3377 },
'klv': { lat:50.2029991149902, lng:12.914999961853 },
'klx': { lat:37.0682983398438, lng:22.0254993438721 },
'kmc': { lat:27.9009, lng:45.528198 },
'kme': { lat:-2.46223998069763, lng:28.9078998565674 },
'kmg': { lat:25.1019444, lng:102.9291667 },
'kmi': { lat:31.877199173, lng:131.449005127 },
'kmj': { lat:32.8372993469238, lng:130.854995727539 },
'kmq': { lat:36.3946, lng:136.406998 },
'kms': { lat:6.71456003189087, lng:-1.59081995487213 },
'kmw': { lat:57.7969017029, lng:41.0194015503 },
'knd': { lat:-2.91917991638, lng:25.9153995514 },
'knh': { lat:24.4279, lng:118.359001 },
'kno': { lat:3.642222, lng:98.885278 },
'knq': { lat:-21.0543003082275, lng:164.837005615234 },
'knx': { lat:-15.7781000137, lng:128.707992554 },
'koa': { lat:19.738783, lng:-156.045603 },
'koc': { lat:-20.5463008880615, lng:164.255996704102 },
'koe': { lat:-10.1716003417969, lng:123.670997619629 },
'koi': { lat:58.9578018188477, lng:-2.90499997138977 },
'koj': { lat:31.8034000396729, lng:130.718994140625 },
'kok': { lat:63.721199, lng:23.143101 },
'kon': { lat:14.3500003814697, lng:108.016998291016 },
'kop': { lat:17.3838005065918, lng:104.642997741699 },
'kos': { lat:10.57970047, lng:103.637001038 },
'kov': { lat:53.329102, lng:69.594597 },
'koz': { lat:57.925362, lng:-152.496715 },
'kpo': { lat:35.987955, lng:129.420383 },
'kpw': { lat:67.845001, lng:166.139999 },
'kqh': { lat:26.601473, lng:74.814147 },
'krb': { lat:-17.4566993713379, lng:140.830001831055 },
'krc': { lat:-2.093, lng:101.4683 },
'krf': { lat:63.0485992431641, lng:17.7688999176025 },
'krk': { lat:50.077702, lng:19.7848 },
'krl': { lat:41.6977996826172, lng:86.1288986206055 },
'krn': { lat:67.821998596191, lng:20.336799621582 },
'kro': { lat:55.4752998352051, lng:65.4156036376953 },
'krp': { lat:56.2975006103516, lng:9.12462997436523 },
'krr': { lat:45.034698486328, lng:39.170501708984 },
'krs': { lat:58.204201, lng:8.08537 },
'krt': { lat:15.5895004272461, lng:32.5531997680664 },
'krw': { lat:40.063301, lng:53.007198 },
'kry': { lat:45.46655, lng:84.9527 },
'ksa': { lat:5.35698, lng:162.957993 },
'ksc': { lat:48.6631011962891, lng:21.2411003112793 },
'ksd': { lat:59.4446983337, lng:13.3374004364 },
'ksf': { lat:51.417273, lng:9.384967 },
'ksh': { lat:34.3459014893, lng:47.1581001282 },
'ksl': { lat:15.3874998092651, lng:36.328800201416 },
'ksn': { lat:53.206901550293, lng:63.5503005981445 },
'kso': { lat:40.4463005066, lng:21.2821998596 },
'ksq': { lat:38.8335990906, lng:65.9215011597 },
'ksu': { lat:63.111801147461, lng:7.824520111084 },
'ksy': { lat:40.562198638916, lng:43.1150016784668 },
'ksz': { lat:61.2358016967773, lng:46.6974983215332 },
'kta': { lat:-20.7122001648, lng:116.773002625 },
'ktm': { lat:27.6966, lng:85.3591 },
'ktn': { lat:55.35559845, lng:-131.7140045 },
'ktp': { lat:17.9885997772217, lng:-76.8237991333008 },
'ktt': { lat:67.700996398926, lng:24.846799850464 },
'ktw': { lat:50.4743, lng:19.08 },
'kua': { lat:3.77538990974426, lng:103.208999633789 },
'kuf': { lat:53.504901885986, lng:50.16429901123 },
'kug': { lat:-10.2250003815, lng:142.218002319 },
'kuh': { lat:43.0410003662, lng:144.192993164 },
'kul': { lat:2.745579957962, lng:101.70999908447 },
'kun': { lat:54.9639015197754, lng:24.0848007202148 },
'kuo': { lat:63.007099, lng:27.7978 },
'kus': { lat:65.573600769, lng:-37.1236000061 },
'kut': { lat:42.176700592, lng:42.4826011658 },
'kuv': { lat:35.9038009643555, lng:126.615997314453 },
'kva': { lat:40.9132995605469, lng:24.6191997528076 },
'kvd': { lat:40.737701, lng:46.3176 },
'kvg': { lat:-2.57940006256, lng:150.807998657 },
'kvo': { lat:43.818298, lng:20.5872 },
'kvx': { lat:58.503299713135, lng:49.348300933838 },
'kwa': { lat:8.72012042999268, lng:167.731994628906 },
'kwe': { lat:26.5384998321533, lng:106.801002502441 },
'kwg': { lat:48.0433006286621, lng:33.2099990844727 },
'kwi': { lat:29.2266006469727, lng:47.9688987731934 },
'kwj': { lat:35.123173, lng:126.805444 },
'kwl': { lat:25.2180995941162, lng:110.039001464844 },
'kwm': { lat:-15.4856004714966, lng:141.751007080078 },
'kwz': { lat:-10.7658996582031, lng:25.5056991577148 },
'kxf': { lat:-17.3458003998, lng:179.42199707 },
'kxk': { lat:50.4090003967285, lng:136.934005737305 },
'kya': { lat:37.979, lng:32.561901 },
'kyd': { lat:22.0270004272461, lng:121.535003662109 },
'kys': { lat:14.4812002182007, lng:-11.4043998718262 },
'kyz': { lat:51.6693992614746, lng:94.4005966186523 },
'kzi': { lat:40.2860984802246, lng:21.840799331665 },
'kzn': { lat:55.606201171875, lng:49.278701782227 },
'kzo': { lat:44.706902, lng:65.592499 },
'kzr': { lat:39.113079, lng:30.128111 },
'lad': { lat:-8.85837, lng:13.2312 },
'lae': { lat:-6.569803, lng:146.725977 },
'lai': { lat:48.754398, lng:-3.47166 },
'lak': { lat:68.223297, lng:-135.00599 },
'lan': { lat:42.7787017822266, lng:-84.58740234375 },
'lao': { lat:18.1781005859375, lng:120.531997680664 },
'lap': { lat:24.0727005005, lng:-110.361999512 },
'laq': { lat:32.7887001037598, lng:21.9643001556397 },
'lar': { lat:41.3120994567871, lng:-105.675003051758 },
'las': { lat:36.08010101, lng:-115.1520004 },
'lax': { lat:33.942501, lng:-118.407997 },
'lba': { lat:53.8658981323242, lng:-1.66057002544403 },
'lbb': { lat:33.663601, lng:-101.822998 },
'lbc': { lat:53.8054008484, lng:10.7192001343 },
'lbd': { lat:40.2154006958008, lng:69.6947021484375 },
'lbe': { lat:40.27590179, lng:-79.40480042 },
'lbf': { lat:41.12620163, lng:-100.6839981 },
'lbj': { lat:-8.48666, lng:119.889 },
'lbl': { lat:37.0442009, lng:-100.9599991 },
'lbs': { lat:-16.4666996002197, lng:179.339996337891 },
'lbu': { lat:5.30068016052246, lng:115.25 },
'lbv': { lat:0.458600014448, lng:9.4122800827 },
'lca': { lat:34.8750991821289, lng:33.6249008178711 },
'lcb': { lat:-15.1934, lng:-59.3848 },
'lce': { lat:15.7425, lng:-86.852997 },
'lcg': { lat:43.302101, lng:-8.37726 },
'lch': { lat:30.1261005401611, lng:-93.2232971191406 },
'lcj': { lat:51.7219009399, lng:19.3980998993 },
'lck': { lat:39.813801, lng:-82.927803 },
'lcx': { lat:25.6746997833, lng:116.747001648 },
'lcy': { lat:51.505299, lng:0.055278 },
'ldb': { lat:-23.3335990906, lng:-51.1301002502 },
'lde': { lat:43.1786994934082, lng:-0.006438999902457 },
'ldu': { lat:5.03224992752075, lng:118.323997497559 },
'ldy': { lat:55.0428009033203, lng:-7.16110992431641 },
'lea': { lat:-22.2355995178, lng:114.088996887 },
'leb': { lat:43.6260986328, lng:-72.3041992188 },
'lec': { lat:-12.4822998047, lng:-41.2770004272 },
'led': { lat:59.8003005981445, lng:30.2625007629395 },
'leh': { lat:49.5339012145996, lng:0.0880559980869293 },
'lei': { lat:36.8438987731934, lng:-2.3701000213623 },
'lej': { lat:51.423889, lng:12.236389 },
'lel': { lat:-12.4989004135132, lng:135.805999755859 },
'leq': { lat:50.102798, lng:-5.67056 },
'ler': { lat:-27.8432998657227, lng:120.703002929688 },
'let': { lat:-4.19355, lng:-69.9432 },
'leu': { lat:42.3386, lng:1.40917 },
'lev': { lat:-17.7110996246, lng:178.759002686 },
'lex': { lat:38.0364990234375, lng:-84.6059036254883 },
'lfq': { lat:36.132629, lng:111.641236 },
'lft': { lat:30.20529938, lng:-91.98760223 },
'lfw': { lat:6.16560983657837, lng:1.25451004505157 },
'lga': { lat:40.777199, lng:-73.872597 },
'lgb': { lat:33.817699, lng:-118.152 },
'lgg': { lat:50.6374015808106, lng:5.44322013854981 },
'lgk': { lat:6.32973003387451, lng:99.7286987304688 },
'lgp': { lat:13.1575, lng:123.735 },
'lgw': { lat:51.148102, lng:-0.190278 },
'lhe': { lat:31.5216007232666, lng:74.4036026000977 },
'lhg': { lat:-29.4566993713379, lng:147.983993530273 },
'lhr': { lat:51.4706, lng:-0.461941 },
'lhw': { lat:36.5152015686, lng:103.620002747 },
'lif': { lat:-20.7747993469238, lng:167.240005493164 },
'lig': { lat:45.8628005981445, lng:1.17944002151489 },
'lih': { lat:21.9759998321533, lng:-159.339004516602 },
'lik': { lat:9.82316, lng:169.307999 },
'lil': { lat:50.563332, lng:3.086886 },
'lim': { lat:-12.0219, lng:-77.114305 },
'lin': { lat:45.445099, lng:9.27674 },
'lio': { lat:9.95796012878418, lng:-83.0220031738281 },
'lir': { lat:10.5933, lng:-85.544403 },
'lis': { lat:38.7813, lng:-9.13592 },
'lit': { lat:34.7294006348, lng:-92.2242965698 },
'liw': { lat:19.691499710083, lng:97.2147979736328 },
'lja': { lat:-3.41700005531311, lng:23.4500007629395 },
'ljg': { lat:26.6800003052, lng:100.246002197 },
'lju': { lat:46.223701, lng:14.4576 },
'lkl': { lat:70.068801879883, lng:24.973499298096 },
'lkn': { lat:68.152496337891, lng:13.609399795532 },
'lko': { lat:26.7605991364, lng:80.8892974854 },
'lla': { lat:65.543800354004, lng:22.121999740601 },
'llc': { lat:18.182388, lng:121.745853 },
'llf': { lat:26.338661, lng:111.610043 },
'llk': { lat:38.7463989258, lng:48.8180007935 },
'llo': { lat:-3.082997, lng:120.245018 },
'llv': { lat:37.683333, lng:111.142778 },
'llw': { lat:-13.7894001007, lng:33.78099823 },
'lmm': { lat:25.6851997375, lng:-109.081001282 },
'lmn': { lat:4.80830001831055, lng:115.01000213623 },
'lmt': { lat:42.156101, lng:-121.733002 },
'lnb': { lat:-16.5841999054, lng:168.158996582 },
'lne': { lat:-15.8655996323, lng:168.17199707 },
'lnk': { lat:40.851001739502, lng:-96.7592010498047 },
'lnl': { lat:33.788, lng:105.797 },
'lno': { lat:-28.8780994415283, lng:121.315002441406 },
'lns': { lat:40.1217002868652, lng:-76.2960968017578 },
'lny': { lat:20.7856006622314, lng:-156.95100402832 },
'lnz': { lat:48.2332, lng:14.1875 },
'lod': { lat:-15.3066997528, lng:167.966995239 },
'loe': { lat:17.4391002655029, lng:101.72200012207 },
'loh': { lat:-3.99589, lng:-79.371902 },
'lop': { lat:-8.757322, lng:116.276675 },
'los': { lat:6.57737016677856, lng:3.32116007804871 },
'lov': { lat:26.9557, lng:-101.470001 },
'lpa': { lat:27.9319000244141, lng:-15.3865995407105 },
'lpb': { lat:-16.5132999420166, lng:-68.1922988891602 },
'lpf': { lat:26.609417, lng:104.979 },
'lpi': { lat:58.4062004089, lng:15.6805000305 },
'lpk': { lat:52.7028007507324, lng:39.5377998352051 },
'lpl': { lat:53.3335990905762, lng:-2.8497200012207 },
'lpm': { lat:-16.4611228, lng:167.829253 },
'lpq': { lat:19.8973007202148, lng:102.161003112793 },
'lps': { lat:48.4838981628418, lng:-122.938003540039 },
'lpt': { lat:18.2709007263184, lng:99.5042037963867 },
'lpx': { lat:56.5175018310547, lng:21.0969009399414 },
'lpy': { lat:45.0806999206543, lng:3.76289010047913 },
'lrd': { lat:27.5438003540039, lng:-99.4616012573242 },
'lre': { lat:-23.4342002869, lng:144.279998779 },
'lrh': { lat:46.17919921875, lng:-1.19527995586395 },
'lrm': { lat:18.4507007598877, lng:-68.9117965698242 },
'lrt': { lat:47.7606010437012, lng:-3.44000005722046 },
'lsc': { lat:-29.916201, lng:-71.199501 },
'lse': { lat:43.879002, lng:-91.256699 },
'lsh': { lat:22.9778995513916, lng:97.752197265625 },
'lsi': { lat:59.8788986206055, lng:-1.29556000232697 },
'lsp': { lat:11.7807750701904, lng:-70.151496887207 },
'lst': { lat:-41.54529953, lng:147.214004517 },
'lsw': { lat:5.22667980194092, lng:96.9503021240234 },
'lsy': { lat:-28.8302993774, lng:153.259994507 },
'ltd': { lat:30.1516990661621, lng:9.71531009674072 },
'lti': { lat:46.3763999938965, lng:96.2210998535156 },
'ltk': { lat:35.4011001586914, lng:35.9486999511719 },
'ltn': { lat:51.874698638916, lng:-0.368333011865616 },
'lto': { lat:25.989200592041, lng:-111.347999572754 },
'ltt': { lat:43.205399, lng:6.482 },
'ltu': { lat:18.411501, lng:76.464699 },
'ltx': { lat:-0.906833, lng:-78.615799 },
'lud': { lat:-26.6874008178711, lng:15.2428998947144 },
'lug': { lat:46.0042991638, lng:8.9105796814 },
'lun': { lat:-15.3308, lng:28.4526 },
'luq': { lat:-33.2732009888, lng:-66.3563995361 },
'luv': { lat:-5.760278, lng:132.759444 },
'lux': { lat:49.6233333, lng:6.2044444 },
'luz': { lat:51.240278, lng:22.713611 },
'lvi': { lat:-17.8218, lng:25.822701 },
'lvo': { lat:-28.6135997772217, lng:122.424003601074 },
'lwk': { lat:60.192199707, lng:-1.24361002445 },
'lwn': { lat:40.7504005432, lng:43.8592987061 },
'lwo': { lat:49.8125, lng:23.9561004638672 },
'lws': { lat:46.3745002746582, lng:-117.014999389648 },
'lwt': { lat:47.0493011474609, lng:-109.467002868652 },
'lwy': { lat:4.84917, lng:115.407997 },
'lxa': { lat:29.2978000641, lng:90.9119033813 },
'lxr': { lat:25.671, lng:32.7066 },
'lxs': { lat:39.917098999, lng:25.2362995148 },
'lya': { lat:34.7411003113, lng:112.388000488 },
'lyh': { lat:37.3266983032227, lng:-79.2004013061523 },
'lyp': { lat:31.3649997711182, lng:72.9947967529297 },
'lys': { lat:45.725556, lng:5.081111 },
'lyx': { lat:50.9561004638672, lng:0.939167022705078 },
'lzc': { lat:18.0016994476, lng:-102.221000671 },
'lzh': { lat:24.2075, lng:109.390999 },
'lzo': { lat:29.030357, lng:105.468407 },
'maa': { lat:12.990005, lng:80.169296 },
'mab': { lat:-5.36858987808, lng:-49.1380004883 },
'mad': { lat:40.471926, lng:-3.56264 },
'maf': { lat:31.9424991607666, lng:-102.202003479004 },
'mag': { lat:-5.20707988739, lng:145.789001465 },
'mah': { lat:39.8625984191895, lng:4.21864986419678 },
'maj': { lat:7.06476020812988, lng:171.272003173828 },
'mam': { lat:25.7698993683, lng:-97.5252990723 },
'man': { lat:53.3536987304688, lng:-2.27495002746582 },
'mao': { lat:-3.03861, lng:-60.049702 },
'maq': { lat:16.6998996734619, lng:98.5450973510742 },
'mar': { lat:10.5582084656, lng:-71.7278594971 },
'mas': { lat:-2.06189, lng:147.423996 },
'mau': { lat:-16.4265003204346, lng:-152.244003295898 },
'mav': { lat:8.70444011688, lng:171.229995728 },
'max': { lat:15.5936, lng:-13.3228 },
'maz': { lat:18.2556991577148, lng:-67.1484985351563 },
'mba': { lat:-4.03483009338379, lng:39.5942001342773 },
'mbd': { lat:-25.7984008789, lng:25.5480003357 },
'mbe': { lat:44.3039016724, lng:143.404006958 },
'mbh': { lat:-25.5133, lng:152.714996 },
'mbi': { lat:-8.919942, lng:33.273981 },
'mbj': { lat:18.5037002563477, lng:-77.9133987426758 },
'mbs': { lat:43.532901763916, lng:-84.0795974731445 },
'mbt': { lat:12.369682, lng:123.630095 },
'mbu': { lat:-9.7475004196167, lng:159.839004516602 },
'mbw': { lat:-37.9757995605469, lng:145.102005004883 },
'mbx': { lat:46.4799003601074, lng:15.6861000061035 },
'mci': { lat:39.2976, lng:-94.713898 },
'mcn': { lat:32.692798614502, lng:-83.6492004394531 },
'mco': { lat:28.4293994903564, lng:-81.3089981079102 },
'mcp': { lat:0.0506640002131, lng:-51.0722007751 },
'mct': { lat:23.5932998657227, lng:58.2844009399414 },
'mcv': { lat:-16.4424991608, lng:136.083999634 },
'mcx': { lat:42.8167991638184, lng:47.6523017883301 },
'mcy': { lat:-26.6033, lng:153.091003 },
'mcz': { lat:-9.51080989837647, lng:-35.7916984558106 },
'mdc': { lat:1.54926002025604, lng:124.926002502441 },
'mde': { lat:6.16454, lng:-75.4231 },
'mdg': { lat:44.5241012573, lng:129.569000244 },
'mdi': { lat:7.70388, lng:8.61394 },
'mdk': { lat:0.0226000007242, lng:18.2887001038 },
'mdl': { lat:21.7021999359131, lng:95.977897644043 },
'mdq': { lat:-37.9342, lng:-57.5733 },
'mdt': { lat:40.1935005188, lng:-76.7633972168 },
'mdu': { lat:-6.14774, lng:143.656998 },
'mdw': { lat:41.785999, lng:-87.752403 },
'mdz': { lat:-32.8316993713, lng:-68.7929000854 },
'mea': { lat:-22.343000412, lng:-41.7659988403 },
'meb': { lat:-37.7281, lng:144.901993 },
'mec': { lat:-0.94607800245285, lng:-80.6788024902344 },
'med': { lat:24.5534, lng:39.705101 },
'mee': { lat:-21.4817008972168, lng:168.037994384766 },
'meg': { lat:-9.52509021759033, lng:16.3124008178711 },
'mei': { lat:32.3325996398926, lng:-88.7518997192383 },
'mel': { lat:-37.673302, lng:144.843002 },
'mem': { lat:35.0424003601074, lng:-89.9766998291016 },
'meu': { lat:-0.889839, lng:-52.6022 },
'mex': { lat:19.4363, lng:-99.072098 },
'mfe': { lat:26.17580032, lng:-98.23860168 },
'mfj': { lat:-18.5666999817, lng:179.951004028 },
'mfm': { lat:22.149599, lng:113.592003 },
'mfr': { lat:42.3741989135742, lng:-122.873001098633 },
'mga': { lat:12.1415004730225, lng:-86.1681976318359 },
'mgb': { lat:-37.7456016540527, lng:140.785003662109 },
'mgf': { lat:-23.47606, lng:-52.016187 },
'mgh': { lat:-30.8574008942, lng:30.343000412 },
'mgm': { lat:32.30059814, lng:-86.39399719 },
'mgq': { lat:2.01444005966187, lng:45.3046989440918 },
'mgt': { lat:-12.0944004059, lng:134.893997192 },
'mgw': { lat:39.64289856, lng:-79.91629791 },
'mgz': { lat:12.4398002624512, lng:98.6214981079102 },
'mhd': { lat:36.2351989746094, lng:59.640998840332 },
'mhg': { lat:49.473057, lng:8.514167 },
'mhk': { lat:39.140998840332, lng:-96.6707992553711 },
'mht': { lat:42.932598, lng:-71.435699 },
'mhu': { lat:-37.0475006104, lng:147.333999634 },
'mia': { lat:25.7931995391846, lng:-80.2906036376953 },
'mid': { lat:20.9370002747, lng:-89.657699585 },
'mig': { lat:31.4281005859375, lng:104.740997314453 },
'mii': { lat:-22.1968994141, lng:-49.926399231 },
'mij': { lat:6.08333, lng:171.733002 },
'mim': { lat:-36.9085998535, lng:149.901000977 },
'mir': { lat:35.7580986022949, lng:10.7546997070313 },
'miu': { lat:11.855299949646, lng:13.0809001922607 },
'mjb': { lat:10.283302, lng:170.869 },
'mjd': { lat:27.3351993560791, lng:68.1430969238281 },
'mjf': { lat:65.783996582031, lng:13.214900016785 },
'mji': { lat:32.894100189209, lng:13.2760000228882 },
'mjk': { lat:-25.8938999176, lng:113.577003479 },
'mjm': { lat:-6.12124013901, lng:23.5690002441 },
'mjn': { lat:-15.6668417421, lng:46.3512325287 },
'mjt': { lat:39.0567016602, lng:26.5983009338 },
'mjz': { lat:62.5346984863281, lng:114.039001464844 },
'mke': { lat:42.9472007751465, lng:-87.896598815918 },
'mkg': { lat:43.169498, lng:-86.238197 },
'mkk': { lat:21.1529006958008, lng:-157.095993041992 },
'mkl': { lat:35.599899, lng:-88.915604 },
'mkr': { lat:-26.6117000579834, lng:118.547996520996 },
'mkw': { lat:-0.891833, lng:134.048996 },
'mky': { lat:-21.1716995239, lng:149.179992676 },
'mla': { lat:35.857498, lng:14.4775 },
'mlb': { lat:28.1028003692627, lng:-80.6453018188477 },
'mle': { lat:4.19183015823364, lng:73.5290985107422 },
'mlg': { lat:-7.92655992508, lng:112.714996338 },
'mli': { lat:41.4485015869141, lng:-90.5074996948242 },
'mlm': { lat:19.849899292, lng:-101.025001526 },
'mln': { lat:35.279800415, lng:-2.9562599659 },
'mls': { lat:46.4280014038086, lng:-105.886001586914 },
'mlu': { lat:32.5108985900879, lng:-92.0376968383789 },
'mlw': { lat:6.28906011581421, lng:-10.7587003707886 },
'mlx': { lat:38.4352989197, lng:38.0909996033 },
'mmb': { lat:43.8805999756, lng:144.164001465 },
'mme': { lat:54.5092010498047, lng:-1.42940998077393 },
'mmg': { lat:-28.1161003112793, lng:117.842002868652 },
'mmj': { lat:36.1668014526367, lng:137.923004150391 },
'mmk': { lat:68.7817001342773, lng:32.7508010864258 },
'mmo': { lat:15.1559000015259, lng:-23.2136993408203 },
'mmx': { lat:55.536305364, lng:13.3761978149 },
'mmy': { lat:24.7828006744, lng:125.294998169 },
'mnb': { lat:-5.93086004257202, lng:12.3517999649048 },
'mnf': { lat:-17.6730995178, lng:177.098007202 },
'mng': { lat:-12.0560998917, lng:134.23399353 },
'mni': { lat:16.7914009094238, lng:-62.1932983398438 },
'mnl': { lat:14.5086, lng:121.019997 },
'mnu': { lat:16.4447002410889, lng:97.6606979370117 },
'mnx': { lat:-5.8113799095154, lng:-61.278301239014 },
'mob': { lat:30.691200256348, lng:-88.242797851562 },
'moc': { lat:-16.7068996429, lng:-43.818901062 },
'mod': { lat:37.62580109, lng:-120.9540024 },
'mof': { lat:-8.64064979553, lng:122.236999512 },
'mol': { lat:62.744701385498, lng:7.2624998092651 },
'moq': { lat:-20.2847003936768, lng:44.3176002502441 },
'mot': { lat:48.2593994140625, lng:-101.279998779297 },
'mov': { lat:-22.057800293, lng:148.07699585 },
'moz': { lat:-17.49, lng:-149.761993 },
'mph': { lat:11.9245, lng:121.954002 },
'mpl': { lat:43.5761985778809, lng:3.96301007270813 },
'mpm': { lat:-25.920799, lng:32.572601 },
'mpn': { lat:-51.8227996826172, lng:-58.4472007751465 },
'mpw': { lat:47.076099395752, lng:37.4496002197266 },
'mqf': { lat:53.3931007385254, lng:58.7556991577148 },
'mql': { lat:-34.2291984558, lng:142.085998535 },
'mqm': { lat:37.2233009338, lng:40.6316986084 },
'mqn': { lat:66.363899230957, lng:14.301400184631 },
'mqp': { lat:-25.3831996918, lng:31.1056003571 },
'mrd': { lat:8.582078, lng:-71.161041 },
'mre': { lat:-1.406111, lng:35.008057 },
'mrs': { lat:43.439271922, lng:5.22142410278 },
'mru': { lat:-20.430201, lng:57.683601 },
'mrv': { lat:44.2251014709473, lng:43.081901550293 },
'mrx': { lat:30.5562000274658, lng:49.1519012451172 },
'mry': { lat:36.5870018005371, lng:-121.843002319336 },
'mrz': { lat:-29.4988994598, lng:149.845001221 },
'msj': { lat:40.7032012939, lng:141.367996216 },
'msl': { lat:34.74530029, lng:-87.61019897 },
'msn': { lat:43.1399002075195, lng:-89.3375015258789 },
'mso': { lat:46.91630173, lng:-114.0910034 },
'msp': { lat:44.882, lng:-93.221802 },
'msq': { lat:53.882499694824, lng:28.030700683594 },
'msr': { lat:38.7477989196777, lng:41.6612014770508 },
'mss': { lat:44.9357986450195, lng:-74.8455963134766 },
'mst': { lat:50.911701, lng:5.77014 },
'msu': { lat:-29.4622993469238, lng:27.5524997711182 },
'msy': { lat:29.9934005737305, lng:-90.2580032348633 },
'msz': { lat:-15.2611999511719, lng:12.1468000411987 },
'mtr': { lat:8.82374, lng:-75.8258 },
'mtt': { lat:18.1033992767, lng:-94.5807037354 },
'mtv': { lat:-13.6660003662, lng:167.712005615 },
'mty': { lat:25.7784996033, lng:-100.107002258 },
'mua': { lat:-8.32796955108643, lng:157.263000488281 },
'mub': { lat:-19.9726009368897, lng:23.4311008453369 },
'muc': { lat:48.353802, lng:11.7861 },
'mue': { lat:20.001301, lng:-155.667999 },
'mun': { lat:9.75452995300293, lng:-63.1473999023438 },
'mur': { lat:4.17897987365723, lng:114.329002380371 },
'mux': { lat:30.2031993865967, lng:71.4190979003906 },
'mvb': { lat:-1.65615999698639, lng:13.4379997253418 },
'mvd': { lat:-34.838402, lng:-56.0308 },
'mvp': { lat:1.25366, lng:-70.2339 },
'mvq': { lat:53.9548988342285, lng:30.095100402832 },
'mvr': { lat:10.4513998031616, lng:14.257399559021 },
'mvs': { lat:-18.048900604248, lng:-39.864200592041 },
'mwp': { lat:28, lng:85.3330001831055 },
'mwx': { lat:34.991406, lng:126.382814 },
'mwz': { lat:-2.4444899559021, lng:32.9327011108398 },
'mxh': { lat:-6.36332988739, lng:143.238006592 },
'mxl': { lat:32.6306, lng:-115.241997 },
'mxp': { lat:45.6306, lng:8.72811 },
'mxs': { lat:-13.7423000335693, lng:-172.257995605469 },
'mxv': { lat:49.6632995605469, lng:100.098999023438 },
'mxx': { lat:60.957901, lng:14.5114 },
'mxz': { lat:24.3500003814697, lng:116.133003234863 },
'mya': { lat:-35.8978004456, lng:150.143997192 },
'myc': { lat:10.2499780654907, lng:-67.6494216918945 },
'myd': { lat:-3.22931003570557, lng:40.1016998291016 },
'mye': { lat:34.073600769, lng:139.559997559 },
'myj': { lat:33.8272018432617, lng:132.699996948242 },
'myp': { lat:37.6194, lng:61.896702 },
'myr': { lat:33.6796989441, lng:-78.9282989502 },
'myt': { lat:25.3836002349854, lng:97.3518981933594 },
'myw': { lat:-10.3390998840332, lng:40.1818008422852 },
'myy': { lat:4.3220100402832, lng:113.986999511719 },
'mzg': { lat:23.5687007904053, lng:119.627998352051 },
'mzh': { lat:40.829399, lng:35.521999 },
'mzi': { lat:14.5128002167, lng:-4.07955980301 },
'mzl': { lat:5.0296, lng:-75.4647 },
'mzo': { lat:20.2880992889404, lng:-77.0892028808594 },
'mzr': { lat:36.706901550293, lng:67.2097015380859 },
'mzt': { lat:23.1613998413, lng:-106.26599884 },
'mzv': { lat:4.04832983016968, lng:114.805000305176 },
'naa': { lat:-30.3192005157, lng:149.82699585 },
'nag': { lat:21.092199, lng:79.047203 },
'naj': { lat:39.1888008117676, lng:45.4584007263184 },
'nal': { lat:43.5129013061523, lng:43.6366004943848 },
'nan': { lat:-17.7553997039795, lng:177.442993164063 },
'nao': { lat:30.79545, lng:106.1626 },
'nap': { lat:40.886002, lng:14.2908 },
'naq': { lat:77.4886016846, lng:-69.3887023926 },
'nas': { lat:25.039, lng:-77.466202 },
'nat': { lat:-5.768056, lng:-35.376111 },
'nav': { lat:38.7719, lng:34.5345 },
'naw': { lat:6.51991987228394, lng:101.74299621582 },
'nbc': { lat:55.5647010803223, lng:52.0924987792969 },
'nbe': { lat:36.075833, lng:10.438611 },
'nbo': { lat:-1.31923997402, lng:36.9277992249 },
'nbs': { lat:42.066944, lng:127.602222 },
'nbx': { lat:-3.36818, lng:135.496002 },
'nce': { lat:43.6584014893, lng:7.21586990356 },
'ncl': { lat:55.0374984741211, lng:-1.69166994094849 },
'ncu': { lat:42.4883995056152, lng:59.6232986450195 },
'ncy': { lat:45.9308333, lng:6.1063889 },
'ndc': { lat:19.1833000183, lng:77.3167037964 },
'ndg': { lat:47.2396011352539, lng:123.917999267578 },
'ndj': { lat:12.1337, lng:15.034 },
'ndk': { lat:5.63166999816895, lng:168.125 },
'ndr': { lat:34.9888000488, lng:-3.0282099247 },
'ndu': { lat:-17.956499099731, lng:19.719400405884 },
'nec': { lat:-38.4831, lng:-58.8172 },
'ner': { lat:56.913898468018, lng:124.91400146484 },
'nfg': { lat:61.1082992553711, lng:72.6500015258789 },
'ngb': { lat:29.8267002105713, lng:121.46199798584 },
'nge': { lat:7.35700988769531, lng:13.5592002868652 },
'ngi': { lat:-18.1156005859, lng:179.339996338 },
'ngo': { lat:34.8583984375, lng:136.804992675781 },
'ngs': { lat:32.9169006348, lng:129.914001465 },
'nhv': { lat:-8.79559993743897, lng:-140.22900390625 },
'nim': { lat:13.4815, lng:2.18361 },
'njc': { lat:60.9492988586426, lng:76.4835968017578 },
'njf': { lat:31.989853, lng:44.404317 },
'nkc': { lat:18.31, lng:-15.9697222 },
'nkg': { lat:31.742000579834, lng:118.861999511719 },
'nkm': { lat:35.2550010681152, lng:136.92399597168 },
'nkt': { lat:37.3647, lng:42.0582 },
'nla': { lat:-12.998100280762, lng:28.66489982605 },
'nld': { lat:27.4438991547, lng:-99.5705032349 },
'nli': { lat:53.154999, lng:140.649994 },
'nlk': { lat:-29.0415992736816, lng:167.938995361328 },
'nma': { lat:40.9846000671, lng:71.5567016602 },
'nnb': { lat:-10.847994, lng:162.454108 },
'nng': { lat:22.6082992553711, lng:108.171997070313 },
'nnr': { lat:53.2303009033203, lng:-9.46778011322022 },
'nnt': { lat:18.8078994750977, lng:100.782997131348 },
'nny': { lat:32.980801, lng:112.614998 },
'nob': { lat:9.97649002075, lng:-85.6529998779 },
'noc': { lat:53.9103012084961, lng:-8.81849002838135 },
'nog': { lat:31.225756, lng:-110.976934 },
'noj': { lat:63.1833000183106, lng:75.2699966430664 },
'nop': { lat:42.015800476074, lng:35.066398620605 },
'nos': { lat:-13.3121004105, lng:48.3148002625 },
'nou': { lat:-22.0146007537842, lng:166.212997436523 },
'nov': { lat:-12.8088998794556, lng:15.7604999542236 },
'npe': { lat:-39.465801, lng:176.869995 },
'npl': { lat:-39.0085983276367, lng:174.179000854492 },
'nqn': { lat:-38.949001, lng:-68.155701 },
'nqt': { lat:52.9199981689453, lng:-1.0791699886322 },
'nqy': { lat:50.440601348877, lng:-4.99540996551514 },
'nra': { lat:-34.7022018433, lng:146.511993408 },
'nrd': { lat:53.706944, lng:7.23 },
'nrk': { lat:58.5862998962402, lng:16.2506008148193 },
'nrn': { lat:51.6024017334, lng:6.14216995239 },
'nrr': { lat:18.245300293, lng:-65.6434020996 },
'nrt': { lat:35.764702, lng:140.386002 },
'nsh': { lat:36.6632995605469, lng:51.4646987915039 },
'nsi': { lat:3.72255992889404, lng:11.5532999038696 },
'nsk': { lat:69.3110961914063, lng:87.3321990966797 },
'nsn': { lat:-41.2983016967773, lng:173.220993041992 },
'nst': { lat:8.5396203994751, lng:99.9447021484375 },
'ntb': { lat:59.565701, lng:9.21222 },
'nte': { lat:47.1531982422, lng:-1.61073005199 },
'ntg': { lat:32.0708007812, lng:120.975997925 },
'ntl': { lat:-32.7949981689453, lng:151.833999633789 },
'ntn': { lat:-17.68409, lng:141.069664 },
'ntq': { lat:37.293098, lng:136.962006 },
'ntt': { lat:-15.977297, lng:-173.791089 },
'nty': { lat:-25.333799, lng:27.173401 },
'nue': { lat:49.498699, lng:11.078056 },
'nus': { lat:-16.0797, lng:167.401001 },
'nuu': { lat:-0.298067, lng:36.159302 },
'nux': { lat:66.0693969726563, lng:76.5203018188477 },
'nva': { lat:2.95015, lng:-75.294 },
'nvk': { lat:68.436897277832, lng:17.386699676514 },
'nvt': { lat:-26.879999, lng:-48.651402 },
'nwi': { lat:52.6758003235, lng:1.28278005123 },
'nyi': { lat:7.36183023452759, lng:-2.32875990867615 },
'nyk': { lat:-0.062399, lng:37.041008 },
'nyo': { lat:58.7886009216309, lng:16.9122009277344 },
'nyt': { lat:19.623501, lng:96.200996 },
'nyu': { lat:21.1788005828857, lng:94.9301986694336 },
'nzc': { lat:-14.8540000916, lng:-74.9615020752 },
'nzh': { lat:49.566667, lng:117.33 },
'nzl': { lat:47.865833, lng:122.767503 },
'oak': { lat:37.721298, lng:-122.221001 },
'oal': { lat:-11.496, lng:-61.4508 },
'oam': { lat:-44.9700012207031, lng:171.082000732422 },
'oax': { lat:16.9999008179, lng:-96.726600647 },
'obo': { lat:42.7332992554, lng:143.216995239 },
'occ': { lat:-0.46288600564003, lng:-76.9868011474609 },
'ocj': { lat:18.4041996002197, lng:-76.9690017700195 },
'ode': { lat:55.4766998291016, lng:10.3309001922607 },
'odo': { lat:57.8661003113, lng:114.242996216 },
'ods': { lat:46.4267997741699, lng:30.6765003204346 },
'oer': { lat:63.4082984924316, lng:18.9899997711182 },
'oes': { lat:-40.7512, lng:-65.0343 },
'ofu': { lat:-14.1844, lng:-169.669998 },
'ogd': { lat:41.195899963379, lng:-112.0120010376 },
'ogg': { lat:20.8986, lng:-156.429993 },
'ogl': { lat:6.80628, lng:-58.1059 },
'ogn': { lat:24.4668998718262, lng:122.977996826172 },
'ogu': { lat:40.966047, lng:38.080994 },
'ogx': { lat:31.917200088501, lng:5.41277980804443 },
'ogz': { lat:43.2051010132, lng:44.6066017151 },
'ohd': { lat:41.18, lng:20.7423 },
'oho': { lat:59.4100646972656, lng:143.056503295898 },
'ohs': { lat:24.38604, lng:56.62541 },
'oim': { lat:34.7820014954, lng:139.36000061 },
'oir': { lat:42.0717010498, lng:139.432998657 },
'oit': { lat:33.4794006348, lng:131.736999512 },
'oka': { lat:26.1958007812, lng:127.646003723 },
'okc': { lat:35.3931007385254, lng:-97.600700378418 },
'okd': { lat:43.117447, lng:141.38134 },
'oke': { lat:27.4255008698, lng:128.701004028 },
'oki': { lat:36.178388, lng:133.323566 },
'okj': { lat:34.756901, lng:133.854996 },
'oky': { lat:-27.4113998413086, lng:151.735000610352 },
'ola': { lat:63.6988983154297, lng:9.60400009155273 },
'olb': { lat:40.898701, lng:9.51763 },
'olj': { lat:-14.8816995621, lng:166.557998657 },
'olp': { lat:-30.4850006104, lng:136.876998901 },
'oma': { lat:41.3032, lng:-95.894096 },
'omh': { lat:37.6680984497, lng:45.0686988831 },
'omo': { lat:43.282901763916, lng:17.8458995819092 },
'omr': { lat:47.0252990722656, lng:21.9025001525879 },
'oms': { lat:54.9669990539551, lng:73.3105010986328 },
'ond': { lat:-17.878201, lng:15.9526 },
'onj': { lat:40.1918983459, lng:140.371002197 },
'ont': { lat:34.0559997558594, lng:-117.600997924805 },
'onx': { lat:9.35663986206055, lng:-79.8674011230469 },
'ool': { lat:-28.1644001007, lng:153.505004883 },
'oom': { lat:-36.3005981445, lng:148.973999023 },
'opo': { lat:41.2481002808, lng:-8.68138980865 },
'opu': { lat:-8.05000019073, lng:142.932998657 },
'orb': { lat:59.2237014770508, lng:15.0380001068115 },
'ord': { lat:41.9786, lng:-87.9048 },
'orf': { lat:36.8945999145508, lng:-76.2012023925781 },
'org': { lat:5.81108, lng:-55.190701 },
'ori': { lat:57.885399, lng:-152.845993 },
'ork': { lat:51.8413009643555, lng:-8.49110984802246 },
'orn': { lat:35.6239013672, lng:-0.621182978153 },
'ory': { lat:48.7233333, lng:2.3794444 },
'osd': { lat:63.194400787354, lng:14.50030040741 },
'osf': { lat:55.511667, lng:37.507222 },
'osk': { lat:57.350498, lng:16.497999 },
'osl': { lat:60.193901062012, lng:11.100399971008 },
'osr': { lat:49.6963005065918, lng:18.1110992431641 },
'oss': { lat:40.6090011597, lng:72.793296814 },
'ost': { lat:51.1988983154, lng:2.8622200489 },
'osw': { lat:51.0724983215332, lng:58.5956001281738 },
'osy': { lat:64.472198486328, lng:11.57859992981 },
'oth': { lat:43.4170989990234, lng:-124.246002197266 },
'otp': { lat:44.5711111, lng:26.085 },
'otz': { lat:66.88469696, lng:-162.598999 },
'oua': { lat:12.3532, lng:-1.51242 },
'oud': { lat:34.7872009277344, lng:-1.92399001121521 },
'ouk': { lat:60.4252, lng:-0.75 },
'oul': { lat:64.930099, lng:25.354601 },
'ovb': { lat:55.012599945068, lng:82.650703430176 },
'ovd': { lat:43.5635986328125, lng:-6.03461980819702 },
'ovs': { lat:61.3266220092773, lng:63.6019134521484 },
'owb': { lat:37.74010086, lng:-87.16680145 },
'oxb': { lat:11.8948001861572, lng:-15.6536998748779 },
'ozh': { lat:47.867000579834, lng:35.3157005310059 },
'ozz': { lat:30.9391002655, lng:-6.90943002701 },
'pac': { lat:8.97334003448486, lng:-79.5556030273438 },
'pad': { lat:51.6141014099, lng:8.61631965637 },
'pag': { lat:7.83073144787, lng:123.461179733 },
'pah': { lat:37.0607986450195, lng:-88.7738037109375 },
'pap': { lat:18.5799999237061, lng:-72.2925033569336 },
'pat': { lat:25.591299057, lng:85.0879974365 },
'pav': { lat:-9.4008798599243, lng:-38.250598907471 },
'paz': { lat:20.6026992798, lng:-97.4608001709 },
'pbc': { lat:19.1581001282, lng:-98.3713989258 },
'pbd': { lat:21.6487007141, lng:69.6572036743 },
'pbg': { lat:44.6509017944336, lng:-73.4681015014648 },
'pbh': { lat:27.4032, lng:89.424599 },
'pbi': { lat:26.6832008361816, lng:-80.0955963134766 },
'pbj': { lat:-16.438999176, lng:168.257003784 },
'pbm': { lat:5.4528298378, lng:-55.1878013611 },
'pbo': { lat:-23.1711006165, lng:117.745002747 },
'pbr': { lat:15.7309, lng:-88.583801 },
'pcl': { lat:-8.37794017791748, lng:-74.5743026733398 },
'pcn': { lat:-41.346099853516, lng:173.95599365234 },
'pcr': { lat:6.18472, lng:-67.4932 },
'pda': { lat:3.85353, lng:-67.9062 },
'pdg': { lat:-0.786917, lng:100.280998 },
'pdl': { lat:37.7411994934, lng:-25.6979007721 },
'pdo': { lat:-3.2860701084137, lng:103.879997253418 },
'pds': { lat:28.627399, lng:-100.535004 },
'pdv': { lat:42.067799, lng:24.8508 },
'pdx': { lat:45.58869934, lng:-122.5979996 },
'ped': { lat:50.0134010314941, lng:15.7385997772217 },
'pee': { lat:57.914501190186, lng:56.021198272705 },
'peg': { lat:43.095901, lng:12.5132 },
'pei': { lat:4.81267, lng:-75.7395 },
'pek': { lat:40.0801010131836, lng:116.584999084473 },
'pem': { lat:-12.6135997772, lng:-69.2285995483 },
'pen': { lat:5.29714012145996, lng:100.277000427246 },
'per': { lat:-31.940299987793, lng:115.967002868652 },
'pes': { lat:61.8852005004883, lng:34.1547012329102 },
'pet': { lat:-31.718399, lng:-52.327702 },
'peu': { lat:15.2622, lng:-83.781197 },
'pev': { lat:45.990898, lng:18.240996 },
'pew': { lat:33.9939002990723, lng:71.5146026611328 },
'pez': { lat:53.1105995178223, lng:45.0210990905762 },
'pfb': { lat:-28.243999, lng:-52.326599 },
'pfo': { lat:34.7179985046387, lng:32.4856986999512 },
'pfr': { lat:-4.329919, lng:20.590124 },
'pgd': { lat:26.92020035, lng:-81.9905014 },
'pgf': { lat:42.7403984069824, lng:2.87067008018494 },
'pgh': { lat:29.0334, lng:79.473701 },
'pgk': { lat:-2.16219997406, lng:106.138999939 },
'pgz': { lat:-25.1847, lng:-50.1441 },
'phc': { lat:5.01549005508423, lng:6.94959020614624 },
'phe': { lat:-20.3777999878, lng:118.625999451 },
'phf': { lat:37.13190079, lng:-76.49299622 },
'phg': { lat:4.84611111111, lng:7.02138888889 },
'phl': { lat:39.8718986511231, lng:-75.241096496582 },
'phs': { lat:16.7828998565674, lng:100.278999328613 },
'phw': { lat:-23.9372005463, lng:31.1553993225 },
'phx': { lat:33.4342994689941, lng:-112.012001037598 },
'phy': { lat:16.6760005951, lng:101.194999695 },
'pia': { lat:40.6641998291, lng:-89.6932983398 },
'pib': { lat:31.4671001434326, lng:-89.3370971679688 },
'pie': { lat:27.91020012, lng:-82.68740082 },
'pif': { lat:22.7001991271973, lng:120.482002258301 },
'pih': { lat:42.9098014831543, lng:-112.596000671387 },
'pik': { lat:55.5093994140625, lng:-4.586669921875 },
'pir': { lat:44.38270187, lng:-100.2860031 },
'pis': { lat:46.5876998901367, lng:0.306665986776352 },
'pit': { lat:40.49150085, lng:-80.23290253 },
'piu': { lat:-5.20574998856, lng:-80.6164016724 },
'pix': { lat:38.554298, lng:-28.441299 },
'pkb': { lat:39.345100402832, lng:-81.4392013549805 },
'pkc': { lat:53.1679000854492, lng:158.453994750977 },
'pke': { lat:-33.131401062, lng:148.238998413 },
'pkk': { lat:21.4043, lng:95.11125 },
'pkn': { lat:-2.7052, lng:111.672997 },
'pkr': { lat:28.2008991241455, lng:83.9821014404297 },
'pku': { lat:0.460786014795303, lng:101.444999694824 },
'pkv': { lat:57.7839012145996, lng:28.3955993652344 },
'pkw': { lat:-22.0583, lng:27.8288 },
'pkx': { lat:39.509945, lng:116.41092 },
'pky': { lat:-2.22513008118, lng:113.943000793 },
'pkz': { lat:15.1321001052856, lng:105.78099822998 },
'plm': { lat:-2.8982501029968, lng:104.69999694824 },
'pln': { lat:45.57089996, lng:-84.79669952 },
'plo': { lat:-34.6053009033, lng:135.880004883 },
'plq': { lat:55.973201751709, lng:21.093900680542 },
'plu': { lat:-19.8512001037598, lng:-43.9505996704102 },
'plw': { lat:-0.91854202747345, lng:119.910003662109 },
'plx': { lat:50.351295, lng:80.234398 },
'plz': { lat:-33.9849014282, lng:25.6173000336 },
'pmc': { lat:-41.4388999938965, lng:-73.0940017700195 },
'pmd': { lat:34.62939835, lng:-118.0849991 },
'pmf': { lat:44.824501, lng:10.2964 },
'pmg': { lat:-22.5496006011963, lng:-55.7025985717773 },
'pmi': { lat:39.551700592, lng:2.73881006241 },
'pmk': { lat:-18.7553005218506, lng:146.580993652344 },
'pmo': { lat:38.175999, lng:13.091 },
'pmq': { lat:-46.537899, lng:-70.978699 },
'pmr': { lat:-40.3205986022949, lng:175.617004394531 },
'pmv': { lat:10.9126033782959, lng:-63.9665985107422 },
'pmw': { lat:-10.2915000916, lng:-48.3569984436 },
'pmy': { lat:-42.7592, lng:-65.1027 },
'pmz': { lat:8.95102977752686, lng:-83.4685974121094 },
'pna': { lat:42.7700004577637, lng:-1.64632999897003 },
'pne': { lat:40.081902, lng:-75.010597 },
'pnh': { lat:11.5466003417969, lng:104.84400177002 },
'pni': { lat:6.98509979248047, lng:158.208999633789 },
'pnk': { lat:-0.150710999965668, lng:109.403999328613 },
'pnl': { lat:36.816502, lng:11.9689 },
'pnp': { lat:-8.80453968048, lng:148.309005737 },
'pnq': { lat:18.5820999145508, lng:73.9197006225586 },
'pnr': { lat:-4.81603002548218, lng:11.8865995407105 },
'pns': { lat:30.4734, lng:-87.1866 },
'pnz': { lat:-9.36240959167481, lng:-40.5690994262695 },
'poa': { lat:-29.9944000244141, lng:-51.1713981628418 },
'pol': { lat:-12.9917621612549, lng:40.5240135192871 },
'pom': { lat:-9.44338035583496, lng:147.220001220703 },
'pop': { lat:19.7579002380371, lng:-70.5699996948242 },
'por': { lat:61.4617, lng:21.799999 },
'pos': { lat:10.5953998565674, lng:-61.3372001647949 },
'poz': { lat:52.4210014343, lng:16.8262996674 },
'ppb': { lat:-22.1751003265, lng:-51.4245986938 },
'ppe': { lat:31.351987, lng:-113.305177 },
'ppg': { lat:-14.3310003281, lng:-170.710006714 },
'ppk': { lat:54.7747001647949, lng:69.1838989257813 },
'ppn': { lat:2.4544, lng:-76.6093 },
'ppp': { lat:-20.4950008392, lng:148.552001953 },
'pps': { lat:9.74211978912354, lng:118.759002685547 },
'ppt': { lat:-17.553699, lng:-149.606995 },
'pqc': { lat:10.1698, lng:103.9931 },
'pqm': { lat:17.533153, lng:-92.015484 },
'pqq': { lat:-31.4358005524, lng:152.863006592 },
'pra': { lat:-31.7948, lng:-60.4804 },
'prc': { lat:34.654499, lng:-112.419998 },
'prg': { lat:50.1008, lng:14.26 },
'pri': { lat:-4.31929016113281, lng:55.6913986206055 },
'prm': { lat:37.1493, lng:-8.58396 },
'prn': { lat:42.5728, lng:21.035801 },
'pry': { lat:-25.6539, lng:28.224199 },
'psa': { lat:43.683899, lng:10.3927 },
'psc': { lat:46.2647018432617, lng:-119.119003295898 },
'pse': { lat:18.00830078125, lng:-66.5630035400391 },
'psg': { lat:56.80170059, lng:-132.9450073 },
'psi': { lat:25.2905006408691, lng:63.345100402832 },
'psm': { lat:43.0778999329, lng:-70.8233032227 },
'pso': { lat:1.39625, lng:-77.2915 },
'psp': { lat:33.8297004699707, lng:-116.50700378418 },
'psr': { lat:42.431702, lng:14.1811 },
'pss': { lat:-27.3858, lng:-55.9707 },
'psv': { lat:60.321701, lng:-1.69306 },
'ptf': { lat:-17.7779006958, lng:177.197006226 },
'ptg': { lat:-23.845269, lng:29.458615 },
'ptj': { lat:-38.3180999755859, lng:141.470993041992 },
'pto': { lat:-26.217184, lng:-52.694463 },
'ptp': { lat:16.265301, lng:-61.531799 },
'pty': { lat:9.0713596344, lng:-79.3834991455 },
'pub': { lat:38.2891006469727, lng:-104.497001647949 },
'puf': { lat:43.3800010681152, lng:-0.418610990047455 },
'pug': { lat:-32.5069007873535, lng:137.716995239258 },
'puj': { lat:18.5673999786, lng:-68.3634033203 },
'puq': { lat:-53.002602, lng:-70.854599 },
'pus': { lat:35.1795005798, lng:128.93800354 },
'puu': { lat:0.505228, lng:-76.5008 },
'puw': { lat:46.7439, lng:-117.110001 },
'puy': { lat:44.8935012817383, lng:13.9222002029419 },
'pvd': { lat:41.732601, lng:-71.420403 },
'pvg': { lat:31.1434001922607, lng:121.805000305176 },
'pvh': { lat:-8.70928955078125, lng:-63.9023017883301 },
'pvk': { lat:38.9254989624023, lng:20.7653007507324 },
'pvr': { lat:20.6800994873047, lng:-105.253997802734 },
'pvu': { lat:40.219200134277, lng:-111.72299957275 },
'pwm': { lat:43.646198, lng:-70.309303 },
'pwq': { lat:52.1949996948242, lng:77.0738983154297 },
'pxm': { lat:15.8769, lng:-97.089103 },
'pxo': { lat:33.0733985901, lng:-16.3500003815 },
'pxr': { lat:14.868300437927, lng:103.49800109863 },
'pxu': { lat:14.0045003890991, lng:108.016998291016 },
'pyh': { lat:5.6199898719788, lng:-67.606101989746 },
'pyj': { lat:66.4003982544, lng:112.029998779 },
'pyk': { lat:35.776100158691, lng:50.826698303223 },
'pzb': { lat:-29.6490001678, lng:30.3987007141 },
'pzh': { lat:31.3584003448486, lng:69.4636001586914 },
'pzi': { lat:26.54, lng:101.79852 },
'pzo': { lat:8.28853034973145, lng:-62.7603988647461 },
'pzu': { lat:19.4335994720459, lng:37.2341003417969 },
'qow': { lat:5.4270601272583, lng:7.20602989196777 },
'qra': { lat:-26.2425003052, lng:28.1511993408 },
'qro': { lat:20.6173, lng:-100.185997 },
'qrw': { lat:5.59611, lng:5.81778 },
'qsf': { lat:36.1781005859, lng:5.32449007034 },
'quo': { lat:4.8725, lng:8.093 },
'rab': { lat:-4.34045982361, lng:152.380004883 },
'rae': { lat:30.9066009521484, lng:41.1381988525391 },
'rai': { lat:14.9245004653931, lng:-23.4934997558594 },
'raj': { lat:22.3092002869, lng:70.7795028687 },
'rak': { lat:31.6068992615, lng:-8.03629970551 },
'ram': { lat:-12.3563995361328, lng:134.897994995117 },
'rao': { lat:-21.1363887786865, lng:-47.776668548584 },
'rap': { lat:44.0452995300293, lng:-103.056999206543 },
'rar': { lat:-21.2026996613, lng:-159.805999756 },
'ras': { lat:37.323333, lng:49.617778 },
'rba': { lat:34.051498, lng:-6.75152 },
'rbr': { lat:-9.869031, lng:-67.893984 },
'rbv': { lat:-8.16806030273438, lng:157.643005371094 },
'rcb': { lat:-28.7409992218, lng:32.0920982361 },
'rch': { lat:11.5262, lng:-72.926 },
'rcl': { lat:-15.4720001221, lng:167.835006714 },
'rdd': { lat:40.50899887, lng:-122.2929993 },
'rdg': { lat:40.3785018920898, lng:-75.965202331543 },
'rdm': { lat:44.2541008, lng:-121.1500015 },
'rdo': { lat:51.3891983032, lng:21.213300705 },
'rdp': { lat:23.6225, lng:87.243 },
'rdu': { lat:35.8776016235352, lng:-78.7874984741211 },
'rdz': { lat:44.407901763916, lng:2.48267006874084 },
'rec': { lat:-8.12648963928223, lng:-34.9235992431641 },
'reg': { lat:38.071201, lng:15.6516 },
'rel': { lat:-43.2105, lng:-65.2703 },
'ren': { lat:51.7957992553711, lng:55.4566993713379 },
'rep': { lat:13.4106998444, lng:103.81300354 },
'res': { lat:-27.45, lng:-59.0561 },
'ret': { lat:67.527801513672, lng:12.103300094604 },
'reu': { lat:41.1473999023438, lng:1.16717004776001 },
'rex': { lat:26.0089, lng:-98.2285 },
'rfd': { lat:42.1954002380371, lng:-89.0971984863281 },
'rfp': { lat:-16.7229, lng:-151.466003 },
'rgl': { lat:-51.6089, lng:-69.3126 },
'rgn': { lat:16.9073009491, lng:96.1332015991 },
'rgo': { lat:41.428538, lng:129.647555 },
'rhi': { lat:45.6311988830566, lng:-89.4674987792969 },
'rho': { lat:36.4053993225098, lng:28.0862007141113 },
'rht': { lat:39.225, lng:101.546 },
'ria': { lat:-29.711399, lng:-53.688202 },
'ric': { lat:37.5051994323731, lng:-77.3197021484375 },
'ris': { lat:45.2420005798, lng:141.186004639 },
'rix': { lat:56.9235992431641, lng:23.9710998535156 },
'riy': { lat:14.6626, lng:49.375 },
'riz': { lat:35.405033, lng:119.324403 },
'rja': { lat:17.1103992462, lng:81.8181991577 },
'rjh': { lat:24.4372005462647, lng:88.6165008544922 },
'rjk': { lat:45.2168998718262, lng:14.5703001022339 },
'rjl': { lat:42.4609534888, lng:-2.32223510742 },
'rjn': { lat:30.297700881958, lng:56.0511016845703 },
'rks': { lat:41.5942, lng:-109.065001 },
'rkt': { lat:25.6135005950928, lng:55.9388008117676 },
'rkv': { lat:64.1299972534, lng:-21.9405994415 },
'rkz': { lat:29.3519, lng:89.311401 },
'rlg': { lat:53.9182014465, lng:12.2783002853 },
'rlk': { lat:40.926, lng:107.7428 },
'rma': { lat:-26.5450000763, lng:148.774993896 },
'rmf': { lat:25.557100296, lng:34.5836982727 },
'rmi': { lat:44.020302, lng:12.6117 },
'rml': { lat:6.82199001312256, lng:79.8861999511719 },
'rmq': { lat:24.2646999359131, lng:120.621002197266 },
'rmu': { lat:37.803, lng:-1.125 },
'rnb': { lat:56.266700744629, lng:15.265000343323 },
'rnj': { lat:27.0440006256, lng:128.401992798 },
'rnn': { lat:55.0633010864258, lng:14.7595996856689 },
'rno': { lat:39.4990997314453, lng:-119.767997741699 },
'rns': { lat:48.0695, lng:-1.73479 },
'roa': { lat:37.3255, lng:-79.975403 },
'rob': { lat:6.23379, lng:-10.3623 },
'roc': { lat:43.1189002990723, lng:-77.6724014282227 },
'roi': { lat:16.1168003082275, lng:103.774002075195 },
'rok': { lat:-23.3819007874, lng:150.475006104 },
'roo': { lat:-16.586, lng:-54.7248 },
'ror': { lat:7.36731, lng:134.544236 },
'ros': { lat:-32.9036, lng:-60.785 },
'rot': { lat:-38.1091995239258, lng:176.317001342773 },
'rov': { lat:47.493888, lng:39.924722 },
'row': { lat:33.301601, lng:-104.530998 },
'rpn': { lat:32.9809989929199, lng:35.5718994140625 },
'rpr': { lat:21.180401, lng:81.7388 },
'rrg': { lat:-19.7577, lng:63.361 },
'rrs': { lat:62.578399658203, lng:11.342300415039 },
'rsa': { lat:-36.588299, lng:-64.275703 },
'rst': { lat:43.9082984924316, lng:-92.5 },
'rsu': { lat:34.8423004150391, lng:127.616996765137 },
'rsw': { lat:26.5361995697022, lng:-81.7552032470703 },
'rtb': { lat:16.316799, lng:-86.523003 },
'rtg': { lat:-8.5970096588135, lng:120.47699737549 },
'rtm': { lat:51.956902, lng:4.43722 },
'rts': { lat:-32.006699, lng:115.540001 },
'rtw': { lat:51.564998626709, lng:46.0466995239258 },
'ruh': { lat:24.9575996398926, lng:46.6987991333008 },
'rul': { lat:0.338085, lng:73.512869 },
'run': { lat:-20.8871002197266, lng:55.5102996826172 },
'rur': { lat:-22.4340991973877, lng:-151.360992431641 },
'rut': { lat:43.52939987, lng:-72.94960022 },
'rvk': { lat:64.838302612305, lng:11.14610004425 },
'rvn': { lat:66.564796447754, lng:25.830400466919 },
'rwn': { lat:50.6071014404297, lng:26.1415996551514 },
'rxs': { lat:11.5977001190186, lng:122.751998901367 },
'ryb': { lat:58.1041984558106, lng:38.9294013977051 },
'ryk': { lat:28.3838996887207, lng:70.2796020507813 },
'ryo': { lat:-51.605, lng:-72.2203 },
'rze': { lat:50.110001, lng:22.018999 },
'rzp': { lat:10.81874, lng:119.507697 },
'rzr': { lat:36.9099006652832, lng:50.6795997619629 },
'sag': { lat:19.688611, lng:74.378889 },
'sah': { lat:15.476300239563, lng:44.2196998596191 },
'sal': { lat:13.4409, lng:-89.055702 },
'san': { lat:32.7336006165, lng:-117.190002441 },
'sap': { lat:15.4526, lng:-87.923599 },
'sat': { lat:29.533701, lng:-98.469803 },
'sav': { lat:32.12760162, lng:-81.20210266 },
'saw': { lat:40.898602, lng:29.3092 },
'sba': { lat:34.42620087, lng:-119.8399963 },
'sbg': { lat:5.87412977219, lng:95.3396987915 },
'sbh': { lat:17.9044, lng:-62.843601 },
'sbn': { lat:41.7086982727051, lng:-86.3172988891602 },
'sbp': { lat:35.2368011475, lng:-120.641998291 },
'sbw': { lat:2.26160001754761, lng:111.985000610352 },
'sby': { lat:38.3404998779297, lng:-75.5102996826172 },
'sbz': { lat:45.7855987548828, lng:24.0912990570068 },
'sce': { lat:40.8493003845, lng:-77.8487014771 },
'scl': { lat:-33.3930015563965, lng:-70.7857971191406 },
'scn': { lat:49.2145996094, lng:7.10950994492 },
'sco': { lat:43.8601, lng:51.091999 },
'scq': { lat:42.8963012695313, lng:-8.41514015197754 },
'sct': { lat:12.6307001113892, lng:53.9057998657227 },
'scu': { lat:19.9698009490967, lng:-75.8354034423828 },
'scv': { lat:47.6875, lng:26.3540992736816 },
'scw': { lat:61.6469993591309, lng:50.845100402832 },
'scx': { lat:16.212600708, lng:-95.2015991211 },
'scz': { lat:-10.7202997207642, lng:165.794998168945 },
'sdd': { lat:-14.9246997833252, lng:13.5749998092651 },
'sde': { lat:-27.7655563354, lng:-64.3099975586 },
'sdf': { lat:38.1744, lng:-85.736 },
'sdg': { lat:35.2458992004395, lng:47.0092010498047 },
'sdj': { lat:38.1397018433, lng:140.917007446 },
'sdk': { lat:5.90089988708496, lng:118.05899810791 },
'sdl': { lat:62.5280990600586, lng:17.4438991546631 },
'sdn': { lat:61.830001831055, lng:6.1058301925659 },
'sdq': { lat:18.42970085144, lng:-69.668899536133 },
'sdr': { lat:43.4271011352539, lng:-3.82000994682312 },
'sds': { lat:38.0601997375, lng:138.414001465 },
'sdt': { lat:34.8135986328125, lng:72.3527984619141 },
'sdu': { lat:-22.9104995728, lng:-43.1631011963 },
'sea': { lat:47.449001, lng:-122.308998 },
'seb': { lat:26.9869995117188, lng:14.4724998474121 },
'sek': { lat:67.4805, lng:153.7364 },
'sen': { lat:51.5713996887207, lng:0.695555984973908 },
'sez': { lat:-4.67434, lng:55.521801 },
'sfa': { lat:34.7179985046387, lng:10.6909999847412 },
'sfb': { lat:28.7775993347168, lng:-81.2375030517578 },
'sfe': { lat:16.5956001281738, lng:120.303001403809 },
'sfg': { lat:18.099899, lng:-63.047199 },
'sfj': { lat:67.0122218992, lng:-50.7116031647 },
'sfn': { lat:-31.7117, lng:-60.8117 },
'sfo': { lat:37.6189994812012, lng:-122.375 },
'sfq': { lat:37.0942993164063, lng:38.8470993041992 },
'sfs': { lat:14.7944, lng:120.271004 },
'sft': { lat:64.6248016357422, lng:21.0769004821777 },
'sgc': { lat:61.3437004089356, lng:73.4018020629883 },
'sgd': { lat:54.9644012451172, lng:9.79172992706299 },
'sgf': { lat:37.24570084, lng:-93.38860321 },
'sgn': { lat:10.8187999725, lng:106.652000427 },
'sgo': { lat:-28.0496997833252, lng:148.595001220703 },
'sgu': { lat:37.036389, lng:-113.510306 },
'sha': { lat:31.1979007720947, lng:121.335998535156 },
'shb': { lat:43.5774993896, lng:144.960006714 },
'shd': { lat:38.2638015747, lng:-78.8964004517 },
'she': { lat:41.6398010253906, lng:123.483001708984 },
'shf': { lat:44.2421, lng:85.8905 },
'shj': { lat:25.3285999298096, lng:55.5172004699707 },
'shl': { lat:25.7035999298096, lng:91.9786987304688 },
'shm': { lat:33.6622009277, lng:135.363998413 },
'sho': { lat:-26.358611, lng:31.716944 },
'shr': { lat:44.7691993713379, lng:-106.980003356934 },
'shv': { lat:32.446602, lng:-93.8256 },
'sid': { lat:16.7414, lng:-22.9494 },
'sif': { lat:27.1595001220703, lng:84.9801025390625 },
'sig': { lat:18.4568004608154, lng:-66.0980987548828 },
'sin': { lat:1.35019, lng:103.994003 },
'sip': { lat:45.0522, lng:33.975101 },
'sit': { lat:57.0471000671387, lng:-135.361999511719 },
'sjc': { lat:37.362598, lng:-121.929001 },
'sjd': { lat:23.1518001556397, lng:-109.721000671387 },
'sje': { lat:2.57969, lng:-72.6394 },
'sji': { lat:12.3614997864, lng:121.04699707 },
'sjj': { lat:43.8246002197266, lng:18.3314990997314 },
'sjk': { lat:-23.2292003631592, lng:-45.861499786377 },
'sjl': { lat:-0.14835, lng:-66.9855 },
'sjo': { lat:9.99386024475098, lng:-84.2088012695313 },
'sjp': { lat:-20.8166007996, lng:-49.40650177 },
'sjt': { lat:31.3577003479004, lng:-100.496002197266 },
'sju': { lat:18.4393997192, lng:-66.0018005371 },
'sjw': { lat:38.2807006835938, lng:114.696998596191 },
'sjy': { lat:62.692101, lng:22.8323 },
'sjz': { lat:38.665501, lng:-28.1758 },
'skb': { lat:17.3111991882324, lng:-62.7187004089356 },
'skc': { lat:-8.0466, lng:141.7222 },
'skd': { lat:39.7005004882813, lng:66.9838027954102 },
'skg': { lat:40.5196990966797, lng:22.9708995819092 },
'skh': { lat:28.586, lng:81.636002 },
'skn': { lat:68.578826904297, lng:15.033416748047 },
'sko': { lat:12.9162998199463, lng:5.20719003677368 },
'skp': { lat:41.961601, lng:21.621401 },
'skt': { lat:32.5355567932, lng:74.3638916016 },
'sku': { lat:38.9676017761, lng:24.4871997833 },
'skx': { lat:54.125129699707, lng:45.2122573852539 },
'skz': { lat:27.7220001220703, lng:68.7917022705078 },
'sla': { lat:-24.8560009003, lng:-65.4861984253 },
'slc': { lat:40.7883987426758, lng:-111.977996826172 },
'sld': { lat:48.6377983093262, lng:19.1340999603272 },
'slh': { lat:-13.8516998291, lng:167.537002563 },
'slk': { lat:44.3852996826172, lng:-74.2061996459961 },
'sll': { lat:17.0387001037598, lng:54.0913009643555 },
'slm': { lat:40.9520988464356, lng:-5.50198984146118 },
'sln': { lat:38.7910003662109, lng:-97.6521987915039 },
'slp': { lat:22.2542991638, lng:-100.930999756 },
'slw': { lat:25.5494995117188, lng:-100.929000854492 },
'sly': { lat:66.5907974243164, lng:66.6110000610352 },
'slz': { lat:-2.58536005020142, lng:-44.2341003417969 },
'sma': { lat:36.9714012145996, lng:-25.1706008911133 },
'smf': { lat:38.6954002380371, lng:-121.591003417969 },
'smi': { lat:37.689998626709, lng:26.9116992950439 },
'smq': { lat:-2.501389, lng:112.975555 },
'smr': { lat:11.1196, lng:-74.2306 },
'sms': { lat:-17.093900680542, lng:49.8157997131348 },
'smt': { lat:-12.479177, lng:-55.672341 },
'smx': { lat:34.89889908, lng:-120.4570007 },
'sna': { lat:33.67570114, lng:-117.8679962 },
'snn': { lat:52.702, lng:-8.92482 },
'sno': { lat:17.1951007843018, lng:104.119003295898 },
'snw': { lat:18.4606990814209, lng:94.3001022338867 },
'sob': { lat:46.686391, lng:17.159084 },
'soc': { lat:-7.513564, lng:110.750494 },
'sod': { lat:-23.478001, lng:-47.490002 },
'sof': { lat:42.6966934204102, lng:23.4114360809326 },
'sog': { lat:61.156101, lng:7.13778 },
'soj': { lat:69.786796569824, lng:20.959400177002 },
'som': { lat:8.9451465606689, lng:-64.151084899902 },
'son': { lat:-15.5050001144, lng:167.220001221 },
'soq': { lat:-0.894, lng:131.287 },
'sou': { lat:50.9502983093262, lng:-1.35679996013641 },
'spc': { lat:28.626499, lng:-17.7556 },
'spd': { lat:25.7591991424561, lng:88.9088973999023 },
'spi': { lat:39.84410095, lng:-89.67790222 },
'spn': { lat:15.119, lng:145.729004 },
'sps': { lat:33.9888, lng:-98.491898 },
'spu': { lat:43.5388984680176, lng:16.2980003356934 },
'sqd': { lat:28.3797, lng:117.9643 },
'sqj': { lat:26.4263, lng:117.8336 },
'sqo': { lat:64.9608993530273, lng:17.6965999603272 },
'sra': { lat:-27.9067, lng:-54.520401 },
'sre': { lat:-19.246835, lng:-65.149611 },
'srg': { lat:-6.97273, lng:110.375 },
'srp': { lat:59.7919006347656, lng:5.34084987640381 },
'srq': { lat:27.3953990936279, lng:-82.5543975830078 },
'srx': { lat:31.0634994507, lng:16.5949993134 },
'sry': { lat:36.635799408, lng:53.1935997009 },
'srz': { lat:-17.8115997314, lng:-63.1715011597 },
'ssa': { lat:-12.9086112976, lng:-38.3224983215 },
'ssg': { lat:3.75527000427246, lng:8.70872020721436 },
'ssh': { lat:27.9773006439, lng:34.3950004578 },
'ssj': { lat:65.956802368164, lng:12.468899726868 },
'sst': { lat:-36.5423, lng:-56.7218 },
'ssy': { lat:-6.26989984512329, lng:14.2469997406006 },
'stc': { lat:45.5466, lng:-94.059898 },
'std': { lat:7.56538, lng:-72.035103 },
'sti': { lat:19.406099319458, lng:-70.6046981811523 },
'stl': { lat:38.748697, lng:-90.370003 },
'stm': { lat:-2.42472195625305, lng:-54.785831451416 },
'stn': { lat:51.8849983215, lng:0.234999999404 },
'str': { lat:48.6898994446, lng:9.22196006775 },
'sts': { lat:38.50899887, lng:-122.8130035 },
'stv': { lat:21.1140995026, lng:72.7417984009 },
'stw': { lat:45.1091995239258, lng:42.1128005981445 },
'stx': { lat:17.7019004821777, lng:-64.7985992431641 },
'sub': { lat:-7.37982988357544, lng:112.787002563477 },
'suf': { lat:38.905399, lng:16.2423 },
'sug': { lat:9.75583832563, lng:125.480947495 },
'sui': { lat:42.8582000732, lng:41.1281013489 },
'suj': { lat:47.7033004760742, lng:22.8857002258301 },
'suk': { lat:67.792, lng:130.394 },
'sun': { lat:43.50439835, lng:-114.2959976 },
'suv': { lat:-18.0433006286621, lng:178.559005737305 },
'sux': { lat:42.402599, lng:-96.384399 },
'suy': { lat:62.185001373291, lng:117.63500213623 },
'svc': { lat:32.632293, lng:-108.154263 },
'svd': { lat:13.156695, lng:-61.149945 },
'svg': { lat:58.876701354, lng:5.6377801895 },
'svi': { lat:2.15217, lng:-74.7663 },
'svj': { lat:68.243301391602, lng:14.669199943542 },
'svl': { lat:61.9431, lng:28.945101 },
'svo': { lat:55.972599, lng:37.4146 },
'svq': { lat:37.4179992675781, lng:-5.8931097984314 },
'svu': { lat:-16.8027992249, lng:179.341003418 },
'svx': { lat:56.743099212646, lng:60.802700042725 },
'svz': { lat:7.84082984924316, lng:-72.439697265625 },
'swa': { lat:23.552, lng:116.5033 },
'swf': { lat:41.504101, lng:-74.104797 },
'swj': { lat:-16.4864, lng:167.4472 },
'swl': { lat:10.525, lng:119.273889 },
'swq': { lat:-8.48904037475586, lng:117.412002563477 },
'sxb': { lat:48.5382995605469, lng:7.62823009490967 },
'sxm': { lat:18.0410003662, lng:-63.1088981628 },
'sxr': { lat:33.9870986938477, lng:74.7742004394531 },
'syd': { lat:-33.9460983276367, lng:151.177001953125 },
'sym': { lat:22.793301, lng:100.959 },
'syo': { lat:38.8121986389, lng:139.787002563 },
'syq': { lat:9.95705032348633, lng:-84.1398010253906 },
'syr': { lat:43.111198425293, lng:-76.1063003540039 },
'sys': { lat:71.92790222168, lng:114.08000183105 },
'syx': { lat:18.3029003143311, lng:109.412002563477 },
'syy': { lat:58.2155990600586, lng:-6.33111000061035 },
'syz': { lat:29.5392, lng:52.589802 },
'sza': { lat:-6.14108991622925, lng:12.3718004226685 },
'szb': { lat:3.13057994842529, lng:101.549003601074 },
'szf': { lat:41.254501, lng:36.567101 },
'szg': { lat:47.7933006287, lng:13.0043001175 },
'szi': { lat:47.487491, lng:84.887675 },
'szx': { lat:22.6392993927002, lng:113.810997009277 },
'szy': { lat:53.481899, lng:20.9377 },
'szz': { lat:53.5847015381, lng:14.9021997452 },
'tac': { lat:11.228035, lng:125.027761 },
'tae': { lat:35.896872, lng:128.65531 },
'tah': { lat:-19.455099105835, lng:169.223999023438 },
'tai': { lat:13.6859998703, lng:44.1390991211 },
'tak': { lat:34.2141990662, lng:134.01600647 },
'tam': { lat:22.2964000702, lng:-97.8658981323 },
'tao': { lat:36.2661018372, lng:120.374000549 },
'tap': { lat:14.7943000793, lng:-92.3700027466 },
'tas': { lat:41.257900238, lng:69.2811965942 },
'tat': { lat:49.073600769, lng:20.2411003113 },
'tay': { lat:58.3074989319, lng:26.6903991699 },
'taz': { lat:41.761101, lng:59.826698 },
'tbb': { lat:13.0495996475, lng:109.333999634 },
'tbh': { lat:12.3109998703, lng:122.084999084 },
'tbj': { lat:36.9799995422363, lng:8.87693977355957 },
'tbn': { lat:37.74160004, lng:-92.14070129 },
'tbo': { lat:-5.0763897895813, lng:32.8333015441895 },
'tbp': { lat:-3.55253005027771, lng:-80.3814010620117 },
'tbs': { lat:41.6692008972, lng:44.95470047 },
'tbt': { lat:-4.2556700706482, lng:-69.93579864502 },
'tbu': { lat:-21.2411994934082, lng:-175.149993896484 },
'tbz': { lat:38.1338996887207, lng:46.2350006103516 },
'tca': { lat:-19.6343994140625, lng:134.182998657227 },
'tco': { lat:1.81442, lng:-78.7492 },
'tcq': { lat:-18.0533008575, lng:-70.2758026123 },
'tcr': { lat:8.724241, lng:78.025803 },
'tdg': { lat:9.07211017608643, lng:126.170997619629 },
'tdx': { lat:12.274600029, lng:102.319000244 },
'tee': { lat:35.4315986633, lng:8.12071990967 },
'teq': { lat:41.1381988525391, lng:27.9190998077393 },
'ter': { lat:38.761799, lng:-27.090799 },
'tet': { lat:-16.1047992706299, lng:33.6402015686035 },
'tez': { lat:26.7091007232666, lng:92.7846984863281 },
'tff': { lat:-3.38294005394, lng:-64.7240982056 },
'tfn': { lat:28.4827003479, lng:-16.3414993286 },
'tfs': { lat:28.044500351, lng:-16.5725002289 },
'tgd': { lat:42.359402, lng:19.2519 },
'tgg': { lat:5.38263988494873, lng:103.102996826172 },
'tgh': { lat:-16.8910999298, lng:168.550994873 },
'tgj': { lat:-21.0960998535156, lng:167.804000854492 },
'tgk': { lat:47.1983333, lng:38.8491667 },
'tgm': { lat:46.467700958252, lng:24.4125003814697 },
'tgo': { lat:43.556702, lng:122.199997 },
'tgr': { lat:33.067798614502, lng:6.0886697769165 },
'tgt': { lat:-5.09236001968384, lng:39.0712013244629 },
'tgu': { lat:14.0608997344971, lng:-87.2172012329102 },
'tgz': { lat:16.5636005402, lng:-93.0224990845 },
'the': { lat:-5.0599398613, lng:-42.8235015869 },
'thg': { lat:-24.4939002990723, lng:150.57600402832 },
'thl': { lat:20.4838008880615, lng:99.9354019165039 },
'thn': { lat:58.3180999755859, lng:12.3450002670288 },
'thq': { lat:34.5593986511, lng:105.86000061 },
'thr': { lat:35.6892013549805, lng:51.3134002685547 },
'ths': { lat:17.238000869751, lng:99.8181991577148 },
'thu': { lat:76.5311965942, lng:-68.7032012939 },
'tia': { lat:41.4146995544, lng:19.7206001282 },
'tif': { lat:21.483001, lng:40.543442 },
'tij': { lat:32.5410995483398, lng:-116.970001220703 },
'tim': { lat:-4.52828, lng:136.886993 },
'tin': { lat:27.7003993988, lng:-8.1670999527 },
'tip': { lat:32.6635017395, lng:13.1590003967 },
'tir': { lat:13.6324996948, lng:79.543296814 },
'tiu': { lat:-44.3027992248535, lng:171.225006103516 },
'tiv': { lat:42.4047012329102, lng:18.7233009338379 },
'tiz': { lat:-5.84499979019, lng:142.947998047 },
'tja': { lat:-21.5557003021, lng:-64.7013015747 },
'tjg': { lat:-2.21655988693, lng:115.435997009 },
'tjk': { lat:40.307430267334, lng:36.3674087524414 },
'tjl': { lat:-20.754199981689, lng:-51.684200286865 },
'tjm': { lat:57.1896018982, lng:65.3243026733 },
'tjq': { lat:-2.74572, lng:107.754997 },
'tju': { lat:37.9880981445313, lng:69.8050003051758 },
'tkd': { lat:4.8960599899292, lng:-1.77476000785828 },
'tkg': { lat:-5.240556, lng:105.175556 },
'tkk': { lat:7.46187019348145, lng:151.843002319336 },
'tkn': { lat:27.8363990783691, lng:128.880996704102 },
'tkq': { lat:-4.8862, lng:29.6709 },
'tks': { lat:34.132801, lng:134.606995 },
'tku': { lat:60.514099, lng:22.2628 },
'tlc': { lat:19.3370990753, lng:-99.5660018921 },
'tle': { lat:-23.3833999633789, lng:43.7285003662109 },
'tlh': { lat:30.3964996337891, lng:-84.3503036499023 },
'tll': { lat:59.4132995605, lng:24.8327999115 },
'tlm': { lat:35.0167007446, lng:-1.45000004768 },
'tln': { lat:43.0973014832, lng:6.14602994919 },
'tls': { lat:43.629101, lng:1.36382 },
'tlu': { lat:9.50945, lng:-75.5854 },
'tlv': { lat:32.0113983154297, lng:34.8866996765137 },
'tly': { lat:44.814998626709, lng:136.29200744629 },
'tme': { lat:6.45108, lng:-71.7603 },
'tmi': { lat:27.315001, lng:87.193298 },
'tmj': { lat:37.2867012023926, lng:67.3099975585938 },
'tml': { lat:9.55718994140625, lng:-0.863214015960693 },
'tmm': { lat:-18.1095008850098, lng:49.3925018310547 },
'tmp': { lat:61.414101, lng:23.604401 },
'tmr': { lat:22.8115005493, lng:5.45107984543 },
'tms': { lat:0.378174990415573, lng:6.71215009689331 },
'tmt': { lat:-1.489599943161, lng:-56.396800994873 },
'tmw': { lat:-31.0839004517, lng:150.847000122 },
'tmx': { lat:29.2371006012, lng:0.276033014059 },
'tna': { lat:36.8572006225586, lng:117.216003417969 },
'tnd': { lat:21.7882995605469, lng:-79.997200012207 },
'tne': { lat:30.6051006317, lng:130.990997314 },
'tng': { lat:35.7268981934, lng:-5.91689014435 },
'tnh': { lat:42.2538888889, lng:125.703333333 },
'tni': { lat:24.5623, lng:80.854897 },
'tnj': { lat:0.922683000565, lng:104.531997681 },
'tnn': { lat:22.9503993988037, lng:120.206001281738 },
'tnr': { lat:-18.7969, lng:47.478802 },
'tob': { lat:31.861, lng:23.907 },
'toe': { lat:33.9397010803223, lng:8.11056041717529 },
'tof': { lat:56.380298614502, lng:85.208297729492 },
'tol': { lat:41.58679962, lng:-83.80780029 },
'tom': { lat:16.7304992675781, lng:-3.00758004188538 },
'tos': { lat:69.6832962036133, lng:18.9188995361328 },
'tou': { lat:-20.7900009155273, lng:165.259002685547 },
'tow': { lat:-24.6863, lng:-53.697498 },
'toy': { lat:36.6483001708984, lng:137.188003540039 },
'tpa': { lat:27.9755001068115, lng:-82.533203125 },
'tpe': { lat:25.0777, lng:121.233002 },
'tpj': { lat:27.3509, lng:87.69525 },
'tpp': { lat:-6.50873994827271, lng:-76.3731994628906 },
'tpq': { lat:21.4195, lng:-104.843002 },
'tps': { lat:37.9114, lng:12.488 },
'tra': { lat:24.6539001465, lng:124.675003052 },
'trc': { lat:25.5683002472, lng:-103.411003113 },
'trd': { lat:63.4578018, lng:10.9239998 },
'trf': { lat:59.1866989136, lng:10.258600235 },
'trg': { lat:-37.6719017028809, lng:176.195999145508 },
'tri': { lat:36.475201, lng:-82.407401 },
'trk': { lat:3.326667, lng:117.569444 },
'trn': { lat:45.200802, lng:7.64963 },
'tro': { lat:-31.8885993958, lng:152.514007568 },
'trr': { lat:8.5385103225708, lng:81.1819000244141 },
'trs': { lat:45.827499, lng:13.4722 },
'tru': { lat:-8.08141040802002, lng:-79.1088027954102 },
'trv': { lat:8.48211956024, lng:76.9200973511 },
'trw': { lat:1.38163995742798, lng:173.147003173828 },
'trz': { lat:10.7653999328613, lng:78.7097015380859 },
'tsa': { lat:25.0694007873535, lng:121.552001953125 },
'tse': { lat:51.0222015380859, lng:71.4669036865234 },
'tsf': { lat:45.648399, lng:12.1944 },
'tsh': { lat:-6.43833, lng:20.794701 },
'tsn': { lat:39.1244010925, lng:117.346000671 },
'tsr': { lat:45.8098983764648, lng:21.3379001617432 },
'tst': { lat:7.50873994827271, lng:99.6166000366211 },
'tsv': { lat:-19.2525005340576, lng:146.764999389648 },
'tta': { lat:28.4482002258301, lng:-11.1612997055054 },
'ttb': { lat:39.9188, lng:9.68298 },
'tte': { lat:0.831414, lng:127.380997 },
'ttg': { lat:-22.619600296, lng:-63.7937011719 },
'ttj': { lat:35.530102, lng:134.167007 },
'ttn': { lat:40.2766990661621, lng:-74.8134994506836 },
'ttq': { lat:10.42, lng:-83.6095 },
'ttt': { lat:22.7549991607666, lng:121.101997375488 },
'tua': { lat:0.809505999088287, lng:-77.7080993652344 },
'tub': { lat:-23.3654003143311, lng:-149.524002075195 },
'tuc': { lat:-26.8409, lng:-65.104897 },
'tud': { lat:13.7368001937866, lng:-13.6531000137329 },
'tuf': { lat:47.4322013855, lng:0.727605998516 },
'tug': { lat:17.6433676823, lng:121.733150482 },
'tui': { lat:31.692188, lng:38.731544 },
'tuk': { lat:25.986400604248, lng:63.030200958252 },
'tul': { lat:36.1983985900879, lng:-95.8880996704102 },
'tun': { lat:36.851001739502, lng:10.2271995544434 },
'tuo': { lat:-38.7397003173828, lng:176.083999633789 },
'tup': { lat:34.2681007385254, lng:-88.7698974609375 },
'tus': { lat:32.115004, lng:-110.938053 },
'tuu': { lat:28.3654, lng:36.6189 },
'tvc': { lat:44.7414016723633, lng:-85.5821990966797 },
'tvs': { lat:39.7178001404, lng:118.002624512 },
'tvy': { lat:14.1038999557495, lng:98.2035980224609 },
'twf': { lat:42.4818, lng:-114.487999 },
'twt': { lat:5.046991, lng:119.742996 },
'twu': { lat:4.32015991210938, lng:118.127998352051 },
'txe': { lat:4.720833, lng:96.849444 },
'txf': { lat:-17.524499893188, lng:-39.66849899292 },
'txk': { lat:33.4537010192871, lng:-93.9909973144531 },
'txn': { lat:29.7332992553711, lng:118.255996704102 },
'tyf': { lat:60.1576004028, lng:12.9912996292 },
'tyl': { lat:-4.5766401290894, lng:-81.254096984863 },
'tyn': { lat:37.7468986511231, lng:112.627998352051 },
'tyr': { lat:32.3540992736816, lng:-95.4023971557617 },
'tys': { lat:35.81100082, lng:-83.9940033 },
'tza': { lat:17.5163898468018, lng:-88.1944427490234 },
'tzx': { lat:40.9950981140137, lng:39.7896995544434 },
'uah': { lat:-8.93611, lng:-139.552002 },
'uak': { lat:61.1604995728, lng:-45.4259986877 },
'uap': { lat:-9.35167, lng:-140.078003 },
'uaq': { lat:-31.571501, lng:-68.418198 },
'uba': { lat:-19.764722824097, lng:-47.966110229492 },
'ubb': { lat:-9.94999980926514, lng:142.182998657227 },
'ubj': { lat:33.9300003052, lng:131.279006958 },
'ubn': { lat:47.646916, lng:106.819833 },
'ubp': { lat:15.2512998581, lng:104.870002747 },
'ucb': { lat:41.129722, lng:113.108056 },
'uct': { lat:63.5668983459473, lng:53.8046989440918 },
'udi': { lat:-18.883612, lng:-48.225277 },
'udj': { lat:48.6343002319336, lng:22.2633991241455 },
'udr': { lat:24.6177005768, lng:73.8961029053 },
'uel': { lat:-17.8554992675781, lng:36.8690986633301 },
'ueo': { lat:26.3635005950928, lng:126.713996887207 },
'uet': { lat:30.2513999938965, lng:66.9377975463867 },
'ufa': { lat:54.557498931885, lng:55.874401092529 },
'uga': { lat:48.8549995422363, lng:103.475997924805 },
'ugc': { lat:41.5843009948731, lng:60.6417007446289 },
'uib': { lat:5.69076, lng:-76.6412 },
'uih': { lat:13.955, lng:109.042 },
'uin': { lat:39.94269943, lng:-91.19460297 },
'uio': { lat:-0.129166666667, lng:-78.3575 },
'uip': { lat:47.9749984741211, lng:-4.16778993606567 },
'uit': { lat:5.90924, lng:169.636993 },
'uje': { lat:8.92805957794, lng:165.761993408 },
'ukb': { lat:34.6328010559082, lng:135.223999023438 },
'ukg': { lat:70.011002, lng:135.645004 },
'ukk': { lat:50.0365982055664, lng:82.4942016601563 },
'ula': { lat:-49.3068, lng:-67.8026 },
'ulb': { lat:-16.3297, lng:168.3011 },
'ulk': { lat:60.7206001282, lng:114.825996399 },
'uln': { lat:47.843102, lng:106.766998 },
'ulo': { lat:50.066588, lng:91.938273 },
'ulp': { lat:-26.6121997833252, lng:144.253005981445 },
'ulv': { lat:54.2682991028, lng:48.2266998291 },
'uly': { lat:54.4010009765625, lng:48.8027000427246 },
'ulz': { lat:47.7093, lng:96.5258 },
'ume': { lat:63.791801452637, lng:20.282800674438 },
'umr': { lat:-31.1441993713379, lng:136.817001342773 },
'ums': { lat:60.356998443604, lng:134.43499755859 },
'upb': { lat:23.0328006744, lng:-82.5793991089 },
'upg': { lat:-5.06162977218628, lng:119.554000854492 },
'upn': { lat:19.3966999053955, lng:-102.039001464844 },
'ura': { lat:51.1507987976074, lng:51.543098449707 },
'urc': { lat:43.9071006774902, lng:87.4741973876953 },
'urg': { lat:-29.7821998596, lng:-57.0382003784 },
'uro': { lat:49.3842010498047, lng:1.17480003833771 },
'urs': { lat:51.7505989074707, lng:36.2956008911133 },
'urt': { lat:9.13259983063, lng:99.135597229 },
'ury': { lat:31.412413, lng:37.278898 },
'ush': { lat:-54.8433, lng:-68.2958 },
'usm': { lat:9.54778957367, lng:100.06199646 },
'usn': { lat:35.59349823, lng:129.352005005 },
'usq': { lat:38.6814994812012, lng:29.471700668335 },
'usr': { lat:64.550003051758, lng:143.11500549316 },
'ust': { lat:29.9592, lng:-81.339798 },
'usu': { lat:12.1215000153, lng:120.099998474 },
'uth': { lat:17.3864002228, lng:102.788002014 },
'utk': { lat:11.222, lng:169.852005 },
'utn': { lat:-28.39909935, lng:21.2602005005 },
'utp': { lat:12.6799001693726, lng:101.004997253418 },
'utt': { lat:-31.5463631849, lng:28.6733551025 },
'uua': { lat:54.6399993896484, lng:52.801700592041 },
'uud': { lat:51.8078002929688, lng:107.438003540039 },
'uus': { lat:46.8886985778809, lng:142.718002319336 },
'uve': { lat:-20.6406002044678, lng:166.572998046875 },
'uvf': { lat:13.7332, lng:-60.952599 },
'uyl': { lat:12.0535001754761, lng:24.9561996459961 },
'vaa': { lat:63.050701, lng:21.762199 },
'val': { lat:-13.2965, lng:-38.992401 },
'van': { lat:38.4682006835938, lng:43.3322982788086 },
'var': { lat:43.232101, lng:27.8251 },
'vas': { lat:39.813801, lng:36.9035 },
'vav': { lat:-18.5853004455566, lng:-173.962005615234 },
'vbs': { lat:45.428902, lng:10.3306 },
'vby': { lat:57.662799835205, lng:18.346200942993 },
'vca': { lat:10.085100174, lng:105.711997986 },
'vce': { lat:45.505299, lng:12.3519 },
'vcp': { lat:-23.0074005127, lng:-47.1344985962 },
'vct': { lat:28.8526000976563, lng:-96.9185028076172 },
'vdb': { lat:61.015598297119, lng:9.2880601882935 },
'vdc': { lat:-14.907885, lng:-40.914804 },
'vde': { lat:27.8148002624512, lng:-17.8871002197266 },
'vdm': { lat:-40.8692, lng:-63.0004 },
'vdo': { lat:21.117778, lng:107.414167 },
'ver': { lat:19.1459007263, lng:-96.1873016357 },
'vfa': { lat:-18.0958995819092, lng:25.8390007019043 },
'vga': { lat:16.530399, lng:80.796799 },
'vgo': { lat:42.2318000793457, lng:-8.62677001953125 },
'vhv': { lat:63.458057403564, lng:120.26916503906 },
'vie': { lat:48.110298156738, lng:16.569700241089 },
'vig': { lat:8.624139, lng:-71.672668 },
'vii': { lat:18.7376003265, lng:105.67099762 },
'vit': { lat:42.8828010559082, lng:-2.72446990013123 },
'vix': { lat:-20.258057, lng:-40.286388 },
'vkg': { lat:9.95802997234, lng:105.132379532 },
'vko': { lat:55.5914993286, lng:37.2615013123 },
'vlc': { lat:39.4893, lng:-0.481625 },
'vld': { lat:30.7824993133545, lng:-83.2767028808594 },
'vli': { lat:-17.699300765991, lng:168.32000732422 },
'vll': { lat:41.7061004639, lng:-4.85194015503 },
'vln': { lat:10.1497325897217, lng:-67.9283981323242 },
'vlv': { lat:9.34047794342041, lng:-70.5840606689453 },
'vly': { lat:53.2481002808, lng:-4.53533983231 },
'vno': { lat:54.634102, lng:25.285801 },
'vns': { lat:25.4524, lng:82.859299 },
'vnt': { lat:57.35779953, lng:21.5442008972 },
'vog': { lat:48.7825012207031, lng:44.3455009460449 },
'voz': { lat:51.8142013549805, lng:39.2295989990234 },
'vps': { lat:30.4832, lng:-86.525398 },
'vpy': { lat:-19.1513004302979, lng:33.4290008544922 },
'vra': { lat:23.0344009399414, lng:-81.435302734375 },
'vrc': { lat:13.5763998031616, lng:124.206001281738 },
'vrk': { lat:62.171101, lng:27.868601 },
'vrl': { lat:41.2743, lng:-7.72047 },
'vrn': { lat:45.395699, lng:10.8885 },
'vsa': { lat:17.9969997406006, lng:-92.8173980712891 },
'vse': { lat:40.725498, lng:-7.88899 },
'vsg': { lat:48.4174003601, lng:39.3740997314 },
'vst': { lat:59.5894012451172, lng:16.6336002349854 },
'vte': { lat:17.9883003235, lng:102.56300354 },
'vtu': { lat:20.9876003265381, lng:-76.9357986450195 },
'vtz': { lat:17.721201, lng:83.224503 },
'vup': { lat:10.435, lng:-73.2495 },
'vvc': { lat:4.16787, lng:-73.6138 },
'vvi': { lat:-17.6448, lng:-63.135399 },
'vvo': { lat:43.3989982604981, lng:132.147994995117 },
'vvz': { lat:26.7234992981, lng:8.62265014648 },
'vxc': { lat:-13.274, lng:35.2663 },
'vxo': { lat:56.9291000366211, lng:14.7279996871948 },
'vyi': { lat:63.75666809082, lng:121.69333648682 },
'wae': { lat:20.5042991638, lng:45.1996002197 },
'wag': { lat:-39.9622001647949, lng:175.024993896484 },
'wat': { lat:52.187198638916, lng:-7.08695983886719 },
'waw': { lat:52.1656990051, lng:20.9671001434 },
'wdh': { lat:-22.4799, lng:17.4709 },
'wds': { lat:32.591667, lng:110.907778 },
'wef': { lat:36.646702, lng:119.119003 },
'weh': { lat:37.1870994567871, lng:122.228996276855 },
'wei': { lat:-12.6786003113, lng:141.925003052 },
'wfi': { lat:-21.4416007995605, lng:47.1116981506348 },
'wga': { lat:-35.1652984619, lng:147.466003418 },
'wgn': { lat:26.802, lng:110.642 },
'wgp': { lat:-9.66922, lng:120.302002 },
'whk': { lat:-37.9206008911133, lng:176.914001464844 },
'wic': { lat:58.4589004516602, lng:-3.09306001663208 },
'wil': { lat:-1.32172000408173, lng:36.8148002624512 },
'win': { lat:-22.3635997772217, lng:143.085998535156 },
'wjr': { lat:1.73324, lng:40.091599 },
'wju': { lat:37.441201, lng:127.963858 },
'wkj': { lat:45.4042015076, lng:141.800994873 },
'wlg': { lat:-41.3272018433, lng:174.804992676 },
'wlh': { lat:-15.4119997025, lng:167.690994263 },
'wls': { lat:-13.2383003235, lng:-176.199005127 },
'wmi': { lat:52.451099, lng:20.6518 },
'wmt': { lat:27.81638, lng:106.33268 },
'wnh': { lat:23.5583, lng:104.3255 },
'wnp': { lat:13.5848999023438, lng:123.269996643066 },
'wns': { lat:26.2194, lng:68.390099 },
'wnz': { lat:27.912201, lng:120.851997 },
'wol': { lat:-34.5611, lng:150.789001 },
'wos': { lat:39.166801, lng:127.486 },
'wpm': { lat:-8.78822040558, lng:142.882003784 },
'wre': { lat:-35.7682991027832, lng:174.365005493164 },
'wrg': { lat:56.48429871, lng:-132.3699951 },
'wro': { lat:51.1026992798, lng:16.885799408 },
'wsz': { lat:-41.7380981445313, lng:171.580993652344 },
'wtb': { lat:-27.558332, lng:151.793335 },
'wte': { lat:9.458333, lng:170.238611 },
'wto': { lat:10.1732997894287, lng:166.003005981445 },
'wuh': { lat:30.7838, lng:114.208 },
'wun': { lat:-26.6291999816895, lng:120.221000671387 },
'wus': { lat:27.7019, lng:118.000999 },
'wut': { lat:38.597456, lng:112.969173 },
'wux': { lat:31.4944000244, lng:120.429000854 },
'wvb': { lat:-22.9799, lng:14.6453 },
'wwk': { lat:-3.58383011818, lng:143.669006348 },
'wya': { lat:-33.0588989257813, lng:137.514007568359 },
'xai': { lat:32.540819, lng:114.079141 },
'xap': { lat:-27.134199142456, lng:-52.656600952148 },
'xbj': { lat:32.8981018066406, lng:59.2661018371582 },
'xch': { lat:-10.4505996704102, lng:105.690002441406 },
'xfn': { lat:32.1506, lng:112.291 },
'xic': { lat:27.9890995025635, lng:102.18399810791 },
'xil': { lat:43.9155998229981, lng:115.963996887207 },
'xiy': { lat:34.447102, lng:108.751999 },
'xls': { lat:16.0508003234863, lng:-16.4631996154785 },
'xmn': { lat:24.5440006256104, lng:118.127998352051 },
'xms': { lat:-2.29917001724243, lng:-78.1207962036133 },
'xna': { lat:36.281898, lng:-94.306801 },
'xnn': { lat:36.5275, lng:102.042999 },
'xqp': { lat:9.44316005706787, lng:-84.1297988891602 },
'xry': { lat:36.744598, lng:-6.06011 },
'xsp': { lat:1.4169499874115, lng:103.86799621582 },
'xuz': { lat:34.059056, lng:117.555278 },
'xwa': { lat:48.258387, lng:-103.748797 },
'xya': { lat:-9.092816, lng:159.21841 },
'yag': { lat:48.6542015075684, lng:-93.439697265625 },
'yam': { lat:46.485001, lng:-84.509399 },
'yao': { lat:3.83604001998901, lng:11.5235004425049 },
'yap': { lat:9.49891, lng:138.082993 },
'yat': { lat:52.9275016784668, lng:-82.4319000244141 },
'yay': { lat:51.3918991089, lng:-56.0830993652 },
'yaz': { lat:49.079833, lng:-125.775583 },
'ybc': { lat:49.1325, lng:-68.204399 },
'ybg': { lat:48.3306007385254, lng:-70.9963989257813 },
'ybl': { lat:49.950802, lng:-125.271004 },
'ybp': { lat:28.858431, lng:104.526157 },
'ybr': { lat:49.91, lng:-99.951897 },
'ybx': { lat:51.4435997009, lng:-57.1852989197 },
'yby': { lat:54.304199, lng:-110.744003 },
'ycd': { lat:49.0549702249, lng:-123.869862556 },
'ycg': { lat:49.2963981628, lng:-117.632003784 },
'ych': { lat:47.007801, lng:-65.449203 },
'ycu': { lat:35.116391, lng:111.031388889 },
'yda': { lat:64.043098449707, lng:-139.128005981445 },
'ydf': { lat:49.2108001708984, lng:-57.3913993835449 },
'ydn': { lat:51.1007995605469, lng:-100.052001953125 },
'ydq': { lat:55.7422981262207, lng:-120.182998657227 },
'yeg': { lat:53.3097000122, lng:-113.580001831 },
'yeh': { lat:38.481899, lng:106.009003 },
'yei': { lat:40.2551994324, lng:29.5625991821 },
'yev': { lat:68.3041992188, lng:-133.483001709 },
'yfa': { lat:52.2014007568359, lng:-81.6968994140625 },
'yfb': { lat:63.756402, lng:-68.555801 },
'yfc': { lat:45.8689002990723, lng:-66.5372009277344 },
'yfo': { lat:54.6781005859375, lng:-101.681999206543 },
'ygb': { lat:49.6941986083984, lng:-124.517997741699 },
'ygh': { lat:66.2407989501953, lng:-128.651000976563 },
'ygj': { lat:35.492199, lng:133.235992 },
'ygk': { lat:44.2252998352051, lng:-76.5969009399414 },
'ygp': { lat:48.7752990723, lng:-64.4785995483 },
'yhd': { lat:49.831699, lng:-92.744202 },
'yhm': { lat:43.1735992432, lng:-79.9349975586 },
'yho': { lat:55.448299407959, lng:-60.2285995483398 },
'yhr': { lat:50.4688987731934, lng:-59.6366996765137 },
'yhu': { lat:45.5175018311, lng:-73.4169006348 },
'yhy': { lat:60.8396987915, lng:-115.782997131 },
'yhz': { lat:44.8807983398, lng:-63.5085983276 },
'yia': { lat:-7.905338, lng:110.057264 },
'yic': { lat:27.8025, lng:114.3062 },
'yih': { lat:30.55655, lng:111.479988 },
'yik': { lat:62.4173011779785, lng:-77.9253005981445 },
'yin': { lat:43.955799, lng:81.330299 },
'yiw': { lat:29.3446998596, lng:120.031997681 },
'yjs': { lat:41.907132, lng:128.409834 },
'yjt': { lat:48.5442008972168, lng:-58.5499992370606 },
'yka': { lat:50.7022018433, lng:-120.444000244 },
'ykf': { lat:43.4608001709, lng:-80.3786010742 },
'ykh': { lat:40.542524, lng:122.3586 },
'ykm': { lat:46.56819916, lng:-120.5439987 },
'yko': { lat:37.5497, lng:44.2381 },
'ykq': { lat:51.4733009338379, lng:-78.75830078125 },
'yks': { lat:62.0932998657227, lng:129.77099609375 },
'ylc': { lat:62.8499984741, lng:-69.8833007812 },
'yle': { lat:63.1316986083984, lng:-117.246002197266 },
'yll': { lat:53.3092002868652, lng:-110.072998046875 },
'ylw': { lat:49.9561004639, lng:-119.377998352 },
'ymh': { lat:52.3027992248535, lng:-55.8471984863281 },
'ymm': { lat:56.653301239, lng:-111.222000122 },
'ymn': { lat:55.0769004821777, lng:-59.1864013671875 },
'ymo': { lat:51.2910995483398, lng:-80.6078033447266 },
'yms': { lat:-5.89377021789551, lng:-76.1182022094727 },
'ymt': { lat:49.771900177002, lng:-74.5280990600586 },
'ynb': { lat:24.144199, lng:38.0634 },
'ynd': { lat:45.521702, lng:-75.563599 },
'yne': { lat:53.9583015441895, lng:-97.8442001342773 },
'ynj': { lat:42.8828010559, lng:129.451004028 },
'ynp': { lat:55.913898, lng:-61.184399 },
'ynt': { lat:37.65722, lng:120.9872 },
'ynt': { lat:37.657222, lng:120.987222 },
'yny': { lat:38.061298, lng:128.669006 },
'yoj': { lat:58.6213989257813, lng:-117.165000915527 },
'yol': { lat:9.25755023956299, lng:12.4303998947144 },
'yop': { lat:58.4914016723633, lng:-119.407997131348 },
'yow': { lat:45.3224983215332, lng:-75.6691970825195 },
'ypa': { lat:53.2141990662, lng:-105.672996521 },
'ype': { lat:56.226898, lng:-117.446999 },
'ypm': { lat:51.8196983337402, lng:-93.9732971191406 },
'ypr': { lat:54.2860984802, lng:-130.445007324 },
'ypw': { lat:49.8342018127441, lng:-124.5 },
'ypy': { lat:58.7672004699707, lng:-111.116996765137 },
'yqb': { lat:46.7911, lng:-71.393303 },
'yqd': { lat:53.9714012145996, lng:-101.091003417969 },
'yqg': { lat:42.2756004333496, lng:-82.9555969238281 },
'yqk': { lat:49.7882995605469, lng:-94.3630981445313 },
'yql': { lat:49.6302986145, lng:-112.800003052 },
'yqm': { lat:46.112202, lng:-64.678596 },
'yqq': { lat:49.7108001708984, lng:-124.887001037598 },
'yqr': { lat:50.4319000244141, lng:-104.666000366211 },
'yqt': { lat:48.3718986511231, lng:-89.3238983154297 },
'yqu': { lat:55.1796989441, lng:-118.885002136 },
'yqx': { lat:48.9369010925293, lng:-54.5680999755859 },
'yqy': { lat:46.1614, lng:-60.047798 },
'yqz': { lat:53.0261001586914, lng:-122.51000213623 },
'yrj': { lat:48.5200004577637, lng:-72.2656021118164 },
'yrl': { lat:51.0668983459473, lng:-93.793098449707 },
'ysb': { lat:46.625, lng:-80.7988967895508 },
'ysj': { lat:45.3161010742188, lng:-65.8902969360352 },
'ysm': { lat:60.0203018188477, lng:-111.96199798584 },
'yso': { lat:54.9105, lng:-59.78507 },
'ysq': { lat:44.938114, lng:124.550178 },
'ytf': { lat:48.5088996887, lng:-71.6418991089 },
'yth': { lat:55.8011016845703, lng:-97.8641967773438 },
'ytm': { lat:46.409401, lng:-74.779999 },
'yts': { lat:48.5696983337, lng:-81.376701355 },
'yty': { lat:32.5634, lng:119.7198 },
'ytz': { lat:43.627499, lng:-79.396202 },
'yub': { lat:69.4332962036133, lng:-133.026000976563 },
'yul': { lat:45.4706001282, lng:-73.7407989502 },
'yum': { lat:32.65660095, lng:-114.6060028 },
'yuy': { lat:48.2061004638672, lng:-78.8356018066406 },
'yvo': { lat:48.0532989502, lng:-77.7827987671 },
'yvq': { lat:65.2816009521484, lng:-126.797996520996 },
'yvr': { lat:49.193901062, lng:-123.183998108 },
'ywg': { lat:49.9099998474, lng:-97.2398986816 },
'ywj': { lat:65.2110977172852, lng:-123.435997009277 },
'ywk': { lat:52.9219017028809, lng:-66.8644027709961 },
'ywl': { lat:52.1831016541, lng:-122.054000854 },
'yxc': { lat:49.610801696777, lng:-115.78199768066 },
'yxe': { lat:52.1707992553711, lng:-106.699996948242 },
'yxh': { lat:50.0189018249512, lng:-110.721000671387 },
'yxj': { lat:56.238098, lng:-120.739998 },
'yxs': { lat:53.8894004822, lng:-122.679000854 },
'yxt': { lat:54.468498, lng:-128.576009 },
'yxu': { lat:43.035599, lng:-81.1539 },
'yxx': { lat:49.0252990722656, lng:-122.361000061035 },
'yxy': { lat:60.7095985413, lng:-135.067001343 },
'yya': { lat:29.311699, lng:113.281574 },
'yyb': { lat:46.363602, lng:-79.422798 },
'yyc': { lat:51.113899231, lng:-114.019996643 },
'yyd': { lat:54.8246994018555, lng:-127.182998657227 },
'yye': { lat:58.8363990784, lng:-122.597000122 },
'yyf': { lat:49.4631004333496, lng:-119.601997375488 },
'yyg': { lat:46.2900009155273, lng:-63.1211013793945 },
'yyj': { lat:48.646900177, lng:-123.426002502 },
'yyr': { lat:53.3191986084, lng:-60.4258003235 },
'yyt': { lat:47.618598938, lng:-52.7518997192 },
'yyu': { lat:49.4138984680176, lng:-82.4674987792969 },
'yyy': { lat:48.6086006164551, lng:-68.2080993652344 },
'yyz': { lat:43.6772003174, lng:-79.6305999756 },
'yzf': { lat:62.4627990722656, lng:-114.440002441406 },
'yzg': { lat:62.1794013977051, lng:-75.6671981811523 },
'yzr': { lat:42.9994010925293, lng:-82.3088989257813 },
'yzt': { lat:50.6805992126465, lng:-127.366996765137 },
'yzv': { lat:50.2233009338379, lng:-66.2656021118164 },
'yzy': { lat:38.8018989563, lng:100.675003052 },
'zac': { lat:56.0894012451172, lng:-96.0892028808594 },
'zad': { lat:44.108299, lng:15.3467 },
'zag': { lat:45.7429008484, lng:16.0687999725 },
'zah': { lat:29.475700378418, lng:60.9062004089356 },
'zal': { lat:-39.6500015259, lng:-73.0860977173 },
'zam': { lat:6.92242002487183, lng:122.059997558594 },
'zat': { lat:27.3255996704102, lng:103.754997253418 },
'zaz': { lat:41.6661987304688, lng:-1.04155004024506 },
'zbr': { lat:25.4433002472, lng:60.3820991516 },
'zcl': { lat:22.8971004486, lng:-102.68699646 },
'zem': { lat:52.2263984680176, lng:-78.5224990844727 },
'zfm': { lat:67.4075012207031, lng:-134.860992431641 },
'zfn': { lat:64.909697, lng:-125.572998 },
'zgu': { lat:-14.2180995941, lng:167.587005615 },
'zha': { lat:21.214399, lng:110.358002 },
'zia': { lat:55.553299, lng:38.150002 },
'zig': { lat:12.5556, lng:-16.281799 },
'zih': { lat:17.601600647, lng:-101.460998535 },
'zix': { lat:66.7965011597, lng:123.361000061 },
'zjn': { lat:52.1206016540527, lng:-101.236000061035 },
'zke': { lat:52.2825012207031, lng:-81.6778030395508 },
'zkp': { lat:65.7485, lng:150.8889 },
'zlo': { lat:19.1448001862, lng:-104.558998108 },
'zlt': { lat:50.8307991027832, lng:-58.9756011962891 },
'zmt': { lat:54.0275001525879, lng:-132.125 },
'zne': { lat:-23.4178009033, lng:119.803001404 },
'znz': { lat:-6.22202, lng:39.224899 },
'zos': { lat:-40.611198, lng:-73.060997 },
'zpc': { lat:-39.2928009033203, lng:-71.915901184082 },
'zqn': { lat:-45.021099, lng:168.738998 },
'zqz': { lat:40.7386016846, lng:114.930000305 },
'zrh': { lat:47.464699, lng:8.54917 },
'zsa': { lat:24.063299, lng:-74.524002 },
'zse': { lat:-21.3208999633789, lng:55.4249992370606 },
'ztb': { lat:50.6744003295898, lng:-59.3835983276367 },
'zth': { lat:37.7509, lng:20.8843 },
'ztu': { lat:41.562222, lng:46.667221 },
'zuh': { lat:22.006399, lng:113.375999 },
'zyi': { lat:27.5895, lng:107.0007 },
'zyl': { lat:24.9631996154785, lng:91.8667984008789 }
        };

        const coords = commonAirports[airportCode.toLowerCase()];
        if (coords) {
            return coords;
        }

        updateStatus(`Airport ${airportCode.toUpperCase()} not in database. Add coordinates manually if needed.`, 'warning');
        return null;
    }

    // Clear all distance circles
    function clearAllCircles() {
        distanceCircles.forEach(item => {
            if (item.cleanup) {
                item.cleanup();
            } else {
                // Fallback cleanup
                if (item.circle) item.circle.setMap(null);
                if (item.marker) item.marker.setMap(null);
            }
        });
        distanceCircles = [];
        updateStatus('All circles cleared', 'success');
    }

    // Update status message
    function updateStatus(message, type = 'info') {
        if (!statusDiv) return;

        const colors = {
            success: '#4CAF50',
            error: '#f44336',
            warning: '#ff9800',
            info: '#2196F3'
        };

        statusDiv.textContent = message;
        statusDiv.style.color = colors[type] || colors.info;

        // Clear status after 5 seconds
        setTimeout(() => {
            if (statusDiv.textContent === message) {
                statusDiv.textContent = '';
            }
        }, 5000);
    }

    // Initialize when page loads
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', waitForMap);
    } else {
        waitForMap();
    }

})();