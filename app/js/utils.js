function redGreen(x, maxX, reversed) {
  if(reversed) { x = maxX - x; }
  var lambda = Math.max(0, Math.min(1, x / maxX)),
      r = Math.max(0, Math.min(1, 2-lambda*2)),
      g = Math.max(0, Math.min(1, lambda*2)),
      b = 0;
  return [255*r, 255*g, 255*b, 1];
}

function heat(x, maxX, reversed) {
  if(reversed) { x = maxX - x; }
  var lambda = Math.max(0, Math.min(1, x / maxX)),
      r = Math.min(1, lambda*3),
      g = Math.max(0, Math.min(1, (lambda-0.33)*3)),
      b = Math.max(0, Math.min(1, (lambda-0.66)*3));
  return [255*r, 255*g, 255*b, 1];
}

function extend(obj, otherObj) {
  if(!obj) { return obj; }
  for(var i in otherObj) { obj[i] = otherObj[i]; }
  return obj;
}

function graphInterpolateData(data, graph) {
  // start with actual data filtered by age
  var outputData = {}, now = Date.now();
  for(var id in data) {
    var datum = data[id];
    // max of 1 hour old
    if(now - datum.when < 1000*60*60*1) {
      outputData[id] = datum;
    }
  }

  function interpolateStep() {
    var newData = {}, nNewData = 0;

    // process each edge
    graph.getEdges().forEach(function(edge) {
      // if already processed, do nothing
      if(outputData[edge.data.id]) { return; }

      // get the source and target nodes
      var srcNode = graph.getNodeById(edge.nodes[0]),
          tgtNode = graph.getNodeById(edge.nodes[1]);

      // get all data for neighbouring edges

      var neighbouringData = [];
      [].concat(
        graph.nodeEdges(srcNode.id),
        graph.nodeEdges(tgtNode.id)
      ).forEach(function(neighbourEdgeId) {
        if(neighbourEdgeId === edge.id) { return; }
        var neighbourEdge = graph.getEdgeById(neighbourEdgeId),
            neighbourEdgeData = outputData[neighbourEdge.data.id];
        if(!neighbourEdgeData) { return; }
        neighbouringData.push(neighbourEdgeData);
      });

      // don't do anything if we've got no neighbouring data
      if(neighbouringData.length === 0) { return; }

      // construct mean of data
      var mean = neighbouringData.reduce(
          function(prev, cur) { return prev + cur.value ;},
          0
      );
      mean /= neighbouringData.length;
      console.assert(!isNaN(mean), mean);

      // construct new data
      newData[edge.data.id] = {
        value: mean,
        interpolated: true,
      };
      nNewData += 1;
    });

    // add new data to output
    outputData = extend(outputData, newData);

    return nNewData;
  }

  do {
    // ... interpolate ...
  } while(interpolateStep() > 0);

  return outputData;
}

function extractVisibleSegments(trafficData, extent, resolution, roadShift) {
  var graphAndTree = graphAndTreeForResolution(trafficData, resolution),
      graph = graphAndTree.graph, tree = graphAndTree.tree,
      visibleLinks = visibleLinksInTree(tree, extent);

  // Create list of line links
  var links = visibleLinks.map(function(link) {
    var edge = graph.getEdgeById(link[4]),
        p1 = graph.getNodeById(edge.nodes[0]).data.pos,
        p2 = graph.getNodeById(edge.nodes[1]).data.pos,
        dx = p2[0]-p1[0], dy = p2[1]-p1[1],
        deltaLen = Math.sqrt(dx*dx + dy*dy),
        unitDelta = [dx/deltaLen, dy/deltaLen],
        lineShift = roadShift * resolution;

    // Extract data for edge
    var edgeData = {
      speed: trafficData.data.speeds[edge.data.id],
      flow: trafficData.data.flows[edge.data.id],
      occupancy: trafficData.data.occupancies[edge.data.id],
    };

    // Each line string is shifted to the "left" in image space
    return {
      data: edgeData,
      geom: [
        [ p1[0] - unitDelta[1]*lineShift, p1[1] + unitDelta[0]*lineShift ],
        [ p2[0] - unitDelta[1]*lineShift, p2[1] + unitDelta[0]*lineShift ],
      ],
      length: deltaLen,
      unitDirection: unitDelta,
    };
  });

  return {
    extent: extent, resolution: resolution,
    links: links, graph: graph, tree: tree,
  };
}

function graphAndTreeForResolution(trafficData, res) {
  var rv = {};
  trafficData.simplified.forEach(function(n) {
    if(n.minResolution && (res < n.minResolution)) { return; }
    if(n.maxResolution && (res > n.maxResolution)) { return; }
    rv.tree = n.tree; rv.graph = n.graph;
  });
  return rv;
}

function visibleLinksInTree(tree, extent) {
  return tree.search(extent);
}
