MetOfficeData = (function() { module = {};

var DATAPOINT_KEY = 'd8997796-bcda-4bce-aff6-3b16f4cacbfd';

// Return promise which is resolved with a JSON object describing the current
// Met Office capabilities.
var fetchCapabilitiesPromise;
function fetchCapabilities() {
  if(fetchCapabilitiesPromise) { return fetchCapabilitiesPromise; }
  fetchCapabilitiesPromise = new Promise(function(resolve, reject) {
    $.ajax({
      url: 'http://datapoint.metoffice.gov.uk/public/data/layer/wxobs/all/json/capabilities',
      data: { key: DATAPOINT_KEY },
      dataType: 'json',
      success: function(data) { resolve(data); },
      error: function(err) {
        console.error('Error fetching capabilities', err);
        reject(new Error('Error fetching capabilities'));
      }
    });
  });
  return fetchCapabilitiesPromise;
}
module.fetchCapabilities = fetchCapabilities;

// Return a promise which is resolved with list of layer objects
function fetchLayerUrls() {
  return fetchCapabilities().then(function(caps) {
    var layerUrls = [], baseUrl = caps.Layers.BaseUrl.$,
        timeAxis = caps.Layers.BaseUrl['@forServiceTimeFormat'];

    caps.Layers.Layer.forEach(function(layerSpec) {
      var layer = {
        displayName: layerSpec['@displayName'],
        name: layerSpec.Service['@name'],
        urls: [],
      };

      // Form URL with most of fields filled in
      var layerUrl, fields = extend({ key: DATAPOINT_KEY }, layerSpec.Service),
          timeFields, jointFields;

      // How many temporal layers are there?
      var timeSpecs = layerSpec.Service[timeAxis], nTimes = 0, timeFieldNames = [];
      for(var timeKey in timeSpecs) {
        if(timeSpecs[timeKey] instanceof Array) {
          timeFieldNames.push(timeKey);
          nTimes = Math.max(nTimes, timeSpecs[timeKey].length);
        }
      }

      for(var timeIdx=0; timeIdx<nTimes; ++timeIdx) {
        timeFields = {};
        for(var timeFieldNameIdx=0; timeFieldNameIdx<timeFieldNames.length; ++timeFieldNameIdx) {
          timeFields[timeFieldNames[timeFieldNameIdx]] =
            timeSpecs[timeFieldNames[timeFieldNameIdx]][timeIdx];
        }
        jointFields = extend(extend({}, fields), timeFields);

        layerUrl = baseUrl;
        for(var fieldName in jointFields) {
          while(layerUrl.indexOf('{'+fieldName+'}') != -1) {
            layerUrl = layerUrl.replace('{'+fieldName+'}', jointFields[fieldName], 'g');
          }
        }

        // Special case for Time
        if(timeFields.Time) { timeFields.Time = new Date(timeFields.Time); }

        layer.urls.push({
          url: layerUrl,
          at: timeFields,
        });
      }

      layerUrls.push(layer);
    });

    return layerUrls;
  });
}
module.fetchLayerUrls = fetchLayerUrls;

return module; })();
