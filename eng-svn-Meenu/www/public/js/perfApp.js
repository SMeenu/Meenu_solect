var app = angular.module('perfApp', []);                                        
app.controller("perfCtrl", function ($scope, $http, $timeout, $window, $location
) {                                                                             
var container = document.getElementById('perfplots');                           
function move() {
    var elem = document.getElementById("myBar"); 
    var width = 1;
    var id = setInterval(frame, 60);
        if (width >= 100) {
            clearInterval(id);
        } else {
            width++; 
            elem.style.width = width + '%'; 
        }
    } 


//var docs = document.getElementById("perfplots");
//docs.setAttribute("src", "anim.gif");


   $http.get("/nwTest").                                                  
                 then( function (results) {
	var no_of_recs = [];
	var node = [];
 	var nodelabel = [];      
	var latency = [];                                                      
	var loss = [];
	var upload = [];
	var download = [];
	var index = [];   
	var via = [];
	no_of_recs = results.data.length;
	console.log("Number of records received:", no_of_recs);                               
        for (var i = 0; i < no_of_recs; i++) {                                           
                //try{                                                          
		node.push(results.data[i].ip);
		nodelabel.push(results.data[i].ip.substring(10,13));
		loss.push(Math.round(results.data[i].loss));
                //}catch{alert("No network connection"); }                      
                latency.push(Math.round(results.data[i].latency));
		upload.push(Math.round(results.data[i].upload));
		download.push(Math.round(results.data[i].download));
		via.push(Math.round(results.data[i].via));
		index.push(5*(i+1));
        }                                
	console.log(loss);
	console.log(latency);
	Highcharts.chart('perfplots', {
        chart: {
            type: 'column'
        },
        title: {
            text: 'Mesh Network Performance Results'
        },
        xAxis: {
            categories: nodelabel
        },
        yAxis: [{
            min: 0,
            title: {
                text: 'Latency (ms) / Error (%)'
            }
        }, {
            title: {
                text: 'Throughput (kbps)'
            },
            opposite: true
        }],
        legend: {
            shadow: false
        },
        tooltip: {
            shared: true
        },
        plotOptions: {
            column: {
                grouping: false,
                shadow: false,
                borderWidth: 0
            }
        },
        series: [{
	 name: 'On-path',
            color: 'rgba(100,0,0,1)',
            data: via,
            tooltip: {
		valuePrefix: 'Connecting ',                
		valueSuffix: ' nodes'
            },
            pointPadding: 0.3,
            pointPlacement: -0.05
	},{
            name: 'Latency',
            color: 'rgba(165,170,217,1)',
            data: latency,
	    tooltip: {
                valueSuffix: ' ms'
            },
            pointPadding: 0.3,
            pointPlacement: -0.05
        }, {
            name: 'Loss',
            color: 'rgba(126,86,13,.9)',
            data: loss,
	    tooltip: {
                valueSuffix: ' %'
            },
            pointPadding: 0.3,
            pointPlacement: -0.15
        }, {
            name: 'Upload Throughput',
            color: 'rgba(248,161,63,1)',
            data: upload,
            tooltip: {
                valueSuffix: ' kbps'
            },
            pointPadding: 0.3,
            pointPlacement: 0.1,
            yAxis: 1
        }, {
            name: 'Download Throughput',
            color: 'rgba(186,60,61,.9)',
            data: download,
            tooltip: {
                valuePrefix: '',
                valueSuffix: ' kbps'
            },
            pointPadding: 0.3,
            pointPlacement: 0.2,
            yAxis: 1
        }]
    });

});
});
