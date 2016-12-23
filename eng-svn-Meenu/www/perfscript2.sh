# Copyright (c) 2016 by Solectria, A Yashkawa Company. All rights reserved.

# History: 2016-11-15 initial version
#		2016-12-22 second version	

# The script identifies neighbors from /etc/solectria/network/network_map.json file
# It is assumed that IP address is stored as the 2nd field in each row
# The MAC address of each node is used to count the number of times it is used as an intermdiate node in routing path
# The script pings each neighboring terminal and estimates the latency and loss percentage
# The upload and download throughput are determined using iperf
# The results are displayed in table format (or stored as perf_results for WebUI) in command line and also stored as key-value pairs in Nw_perf.json file

# Methodology:
# ------------
# An iperf server deamon is waiting in every terminal
# The default port 5001 is having issues with bodirectional address binding. 
# So the iperf server is made to wait in port 13130
# One terminal (probably the gateway) acts as the iperf client and connects with each iperf server running 
# in the available neighbors: This gives the upload throughput
# The download through is determined by reversing the client server roles
# A function to restrict the span of each command is used for iperf to manage connection issues

# This function avoids the long pause if the connection could not be extablished with the neighbor

# Modes of running:
# 1. Quick (skips throughput computation); Avg span: 7 secs/node
# 2. Extensive (includes throughput computation); Avg span: 25 secs/node - linearly increases with the network size
# This version is silent and not interactive

LOG_DIR=/etc/solectria/log/
LOGFILE_HEADER=solectria_
LOGFILE_NAME=${LOG_DIR}${LOGFILE_HEADER}nw_perf.json
#echo "logfile " ${LOGFILE_NAME}

f_tout () {
        $1  &
        sleep $2
        kill $! 2> /dev/null
        (( $? == 0 )) && (echo failed 1> ${LOG_DIR}ferr) && (kill_flag=1);
}

function clean_up() {
	#        rm -f ${LOGFILE_NAME}
	rm -f ${LOG_DIR}f1 2>/dev/null
        rm -f ${LOG_DIR}f2 2>/dev/null
        rm -f ${LOG_DIR}f3 2>/dev/null
        rm -f ${LOG_DIR}ferr 2>/dev/null
#	rm -f Nw_perf.json 2>/dev/null
	rm -f status
	f_tout 'nohup iperf -s' 8 2>&1 /dev/null
        exit 0
}
mkdir -p ${LOG_DIR}
rm -f status 2>/dev/null
rm -f ${LOGFILE_NAME} 2>/dev/null
rm -f ${LOG_DIR}f1 2>/dev/null
rm -f ${LOG_DIR}f2 2>/dev/null
rm -f ${LOG_DIR}f3 2>/dev/null
rm -f ${LOG_DIR}ferr 2>/dev/null
#echo "stopping iperf instance"
x=$(ps -ef | grep 'iperf')
kill $(echo $x |head -n2 | tail -n1 | awk -F " " '{print $2 }') 2> /dev/null

# Array stores the parameter string and calculated value in subsequent positions                                                    
arr=
# Array index
count=0
# echo "... Identifying neighbors"
grep "ipv4" /etc/solectria/network/network_map.json | awk -F ',' '{print $2}' |awk -F ':' '{print $2}' | sed 's,..\(.*\).$,\1,g' > ${LOG_DIR}f1
n_nodes=$(cat ${LOG_DIR}f1 | wc -l)
>&2 echo $n_nodes 1>&2
# read choice
choice=$1

# Obtain self-IP address of br0
my_ip=$(ifconfig | grep 'inet addr:' | cut -d: -f2 | awk 'NR==1{ print $1}')
# For each neighbor identified:
for ip in $(cat  ${LOG_DIR}/f1); do
mac=$(grep $ip /etc/solectria/network/network_map.json | awk -F ',' '{print $1}' |awk  -F ' ' '{print $2}' |sed 's,..\(.*\).$,\1,g') 
via=$(grep $mac /etc/solectria/network/network_map.json |wc -l) 
if [ $ip == $my_ip ] || [ $ip == "127.0.0.0" ] || [ $ip == "0.0.0.0" ]; then
continue
fi
flag_continue=0;
arr[$count]="IPaddr" && ((count++))
arr[$count]="$ip" && ((count++))
#Uncomment the following if MAC address is to be included
#arr[$count]="MACaddr" && ((count++))
#arr[$count]="$mac" && ((count++))
arr[$count]="Via_count" && ((count++))
arr[$count]="$via" && ((count++))
arr[count]="Loss" && ((count++))
ping -c4 $ip >  ${LOG_DIR}f2
if [ $? -ne 0 ]; then 
	flag_continue=1;
	arr[count]="100" && ((count++))
	arr[count]="Latency" && ((count++))
	arr[count]="0" && ((count++))
else
	# Loss estimate:
	arr[count]=$(grep 'received' ${LOG_DIR}f2 |awk -F "," 'match($0,/packet loss/) {print substr($0, RSTART-5, 3)}' | sed "s/[^0-9]//g")  && ((count++))
	arr[count]="Latency" && ((count++))
	# print the average latency in ms:
	arr[count]=$(cat  ${LOG_DIR}f2 | grep 'rtt' | awk -F ' ' '{print $4}' | awk -F '/' '{print $2}') && ((count++))
fi

if [ $choice == "1" ]; then
	continue; 
else
#Initializing temporary array to store the iperf output strings
y=                                                                              
i=0;     
# To break the loop if iperf fails 
arr[count]="Upload"  && ((count++))
if [ $flag_continue == 1 ]; then
 arr_tmp=("0" "Download" "0")
 arr=("${arr[@]}" "${arr_tmp[@]}") 
 count=$((count+3))
 continue;                      
 continue     
else
#iperf -c $ip -d >  ${LOG_DIR}f3 2>  ${LOG_DIR}ferr
f_tout "iperf -c $ip -d" 34 1>  ${LOG_DIR}f3 2>  ${LOG_DIR}ferr
 if (grep "failed"  ${LOG_DIR}ferr) ; then
 arr=("${arr[@]}" "${arr_tmp[@]}")
 count=$((count+3))
 continue;
 continue
fi

# Computing upload throughput in kbps
upload_unit=$(cat  ${LOG_DIR}f3 |grep "bits/sec"|awk 'NR==1 {print $NF}')
upload_kbps="$(cat  ${LOG_DIR}f3 |grep "bits/sec"|awk 'NR==1 {print $(NF-1)}')"
if [ $upload_unit == "Mbits/sec" ]; then 
arr[count]=$( echo "$upload_kbps * 1000"|bc ) && ((count++))
else 
arr[count]=$upload_kbps  && ((count++))
fi

# Computing download throughput in kbps
arr[count]="Download" && ((count++))
# arr[count]="$(tail -1  ${LOG_DIR}f3 | awk -F ' ' '{print $(NF-1)$NF}')" && ((count++))

dnload_unit="$(tail -1  ${LOG_DIR}f3 | awk -F ' ' '{print $NF}')"
dnload_kbps="$(tail -1  ${LOG_DIR}f3 | awk -F ' ' '{print $(NF-1)}')"
if [ $dnload_unit == "Mbits/sec" ]; then 
arr[count]=$( echo "$dnload_kbps * 1000"|bc )
else 
arr[count]=$dnload_kbps
fi
((count++))
fi
fi
done 

# ==================
# Output formatting:
# ==================

width=43
vars=(${arr[@]})
len=${#arr[@]}

# Generation of Nw_perf.json file
(printf "\n{\"network\": {\n\t \"mesh\":{\n\t\t \"performance\":[\n"
for (( i=0; i<$len; i+=2 )); do
	if (( $i == 0 )); then
 		printf "\t\t{"
	fi                                                                       
    	printf "\"${arr[i]}\": \"${vars[i+1]}\""
	j=$((i+2))
	if [ $choice == "1" ] && (( $j % 8 == 0 && $i < $((len-2)) )); then
		 printf "},\n\t\t{"
        elif [ $choice == "2" ] && (( $j % 12 == 0 && $i < $((len-2)) ));  then
		printf "},\n\t\t{"
	elif (( $i == $((len-2)) )); then
                printf "} \n \t\t\t]\n\t\t}\n\t}\n"
	elif [ $i -lt $((len-2)) ] ; then
	        printf ","
	fi
done                                                                            
printf "}\n") > "Nw_perf.json"      
echo "Completed" > status
clean_up 2>&1 /dev/null
cat Nw_perf.json
