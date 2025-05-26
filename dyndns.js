#!/usr/bin/env ucode
'use strict';

const DOMAIN = "my.domain";
const CUSTOMERNO = "12345";
const APIKEY = "APIKEY_CREATED_IN_CUSTOMERPORTAL";
const APIPASSWD = "APIPASSWD_FROM_CUSTOMERPORTAL";
const V6SUFFIX = "local_ipv6_suffix"

import { open } from 'fs';
let uloop = require("uloop");
let uclient = require("uclient");
let resolv = require("resolv");
let dns = "";
let result;
let sessid;
let logged = false;
let logf;

function log(message) {
	if (!logged) {
		logf = open("/var/log/dyndns.log","a",0o660);
		let now = localtime();
		logf.write(sprintf("%d-%02d-%02d %02d:%02d:%02d",now.year,now.mon,now.mday,now.hour,now.min,now.sec));
		logged = true;
	}
	logf.write(message);
}

function get_ip(service) {
	uc.set_url(service);
	if(!uc.connect()) {
		log(` Failed to connect to ${service}\n`);
		exit(1);
	}
	if(!uc.request("GET")) {
		log(" Failed to send request!\n");
		exit(1);
	}
	uloop.run();
	uc.disconnect();
	return result;
}

function send_message(message) {
	let headers={headers:{"content-type":"application/json"}};
	message.param.apikey=APIKEY;
	message.param.customernumber=CUSTOMERNO;
	if(sessid) message.param.apisessionid=sessid;

	//printf("sending: %.J\n",message);
	headers.post_data=sprintf("%J",message);

	if(!uc.ssl_init()) {
		log(" Failed to init ssl\n");
		exit(1);
	}
	if(!uc.connect()) {
		log(" Failed to connect https\n");
		exit(1);
	}
	if (!uc.request("POST",headers)) {
		log(" Failed to send request\n");
		exit(1);
	}
	uloop.run();
	result=json(result);
	uc.disconnect();
	if (result.status!="success") {
		log (result.longmessage+"\n");
		exit (1);
	}
}

////////////////////main///////////////////////////

uloop.init();
uc = uclient.new("http://x", null, {
	data_read: (cb) => {
		let data;
		result="";
		while(length(data=uc.read()) > 0)
			result=result+data;
	},
	data_eof: uloop.end,
	error: (cb, code) => {
		log("Error:"+code+"\n");
		uloop.end();
	}
});

let ipv4 = get_ip("http://v4.ident.me/");
if (ipv4 == null) {
	log("could not get local ipv4 address\n");
	exit(1);
}
result = resolv.query(DOMAIN);
if(result==null){
	log (sprintf(" could not resolve %s: %s\n", DOMAIN, resolv.error()));
	exit(1);
}

if(result[DOMAIN]["A"][0]==ipv4) exit(0);

let ipv6 = get_ip("http://v6.ident.me/");
//replace the last 19 chars with the address of host
ipv6 = substr(ipv6,0,-19)+V6SUFFIX;

uc.set_url("https://ccp.netcup.net/run/webservice/servers/endpoint.php?JSON");
send_message({action:"login",param:{apipassword:APIPASSWD}});
sessid=result.responsedata.apisessionid;

send_message({action:"infoDnsRecords",param:{domainname:DOMAIN}});
let modified=false;
let records=result.responsedata.dnsrecords;
for (let i=0; i<length(records); i++) {
	if (records[i].hostname=="mail")
		continue;
	switch (records[i].type) {
		case 'A':
			if(records[i].destination!=ipv4) {
				log(` updating ${records[i].hostname} to ${ipv4}\n`);
				records[i].destination=ipv4;
				modified=true;
			}
			break;
		case 'AAAA':
			if(records[i].destination!=ipv6) {
				log(` updating ${records[i].hostname} to ${ipv6}\n`);
				records[i].destination=ipv6;
				modified=true;
			}
			break;
	}
}

if (modified){
	send_message(
		{action:"updateDnsRecords",
		param:{domainname:DOMAIN,dnsrecordset:{dnsrecords:records}}}
	);
} else {
	log (" records already up to date\n");
}

send_message({action:"logout",param:{}});
if (logged) logf.close();
