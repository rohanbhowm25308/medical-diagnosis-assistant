

// Review Input
const reviewInput = document.getElementById("reviewInput");

// Buttons
const analyzeBtn = document.getElementById("analyzeBtn");
const clearInput = document.getElementById("clearInput");
const voiceBtn = document.getElementById("voiceBtn");
const liveAnalyticsBtn = document.getElementById("liveAnalyticsBtn");
const exportBtn = document.getElementById("exportCSV");
const clearHistoryBtn = document.getElementById("clearHistory");
const backToTop = document.getElementById("backToTop");

// Result
const sentimentResult = document.getElementById("sentimentResult");
const emoji = document.getElementById("emoji");
const confidenceScore = document.getElementById("confidenceScore");
const confidenceMeter = document.getElementById("confidenceMeter");
const confidenceFill = document.getElementById("confidenceFill");
const progressFill = document.getElementById("progressFill");

// Dashboard
const totalReviews = document.getElementById("totalReviews");
const positiveReviews = document.getElementById("positiveReviews");
const negativeReviews = document.getElementById("negativeReviews");
const neutralReviews = document.getElementById("neutralReviews");

// Statistics
const avgConfidence = document.getElementById("avgConfidence");
const highestConfidence = document.getElementById("highestConfidence");
const lowestConfidence = document.getElementById("lowestConfidence");

// History
const historyContainer = document.getElementById("historyContainer");
const searchHistory = document.getElementById("searchHistory");

// Hero Counters
const counters = document.querySelectorAll(".counter");

// Scroll Progress
const scrollProgress = document.getElementById("scrollProgress");

// Navbar
const navbar = document.querySelector(".navbar");

/*=========================================================
GLOBAL VARIABLES
=========================================================*/

let history = [];

let confidenceArray = [];

let positive = 0;
let negative = 0;
let neutral = 0;
let total = 0;

let liveMode = false;

/*=========================================================
POSITIVE KEYWORDS
=========================================================*/

const positiveWords = [

"good",
"great",
"excellent",
"awesome",
"amazing",
"fantastic",
"perfect",
"love",
"loved",
"best",
"happy",
"wonderful",
"super",
"fast",
"beautiful",
"recommended",
"brilliant",
"nice",
"easy",
"quality",
"helpful",
"friendly",
"satisfied"

];

/*=========================================================
NEGATIVE KEYWORDS
=========================================================*/

const negativeWords = [

"bad",
"worst",
"terrible",
"poor",
"awful",
"hate",
"horrible",
"slow",
"late",
"broken",
"problem",
"issue",
"refund",
"angry",
"damaged",
"useless",
"disappointed",
"boring",
"bug",
"error",
"crash",
"waste"

];

/*=========================================================
INITIALIZE APPLICATION
=========================================================*/

window.addEventListener("load", () => {

    animateCounters();

    updateDashboard();

    window.scrollTo({

        top: 0,

        behavior: "instant"

    });

});

/*=========================================================
EVENT LISTENERS
=========================================================*/

analyzeBtn?.addEventListener("click", analyzeReview);

clearInput?.addEventListener("click", clearReview);

voiceBtn?.addEventListener("click", startVoiceRecognition);

liveAnalyticsBtn?.addEventListener("click", toggleLiveAnalytics);

exportBtn?.addEventListener("click", exportHistory);

clearHistoryBtn?.addEventListener("click", clearHistory);

searchHistory?.addEventListener("input", filterHistory);

backToTop?.addEventListener("click", () => {

    window.scrollTo({

        top:0,

        behavior:"smooth"

    });

});

/*=========================================================
SCROLL EVENTS
=========================================================*/

window.addEventListener("scroll", () => {

    updateScrollProgress();

    toggleBackToTop();

    navbarEffect();

});

/*=========================================================
COUNTER ANIMATION
=========================================================*/

function animateCounters(){

    counters.forEach(counter=>{

        const target = Number(counter.dataset.target);

        let count = 0;

        const speed = target / 100;

        const update = ()=>{

            count += speed;

            if(count < target){

                counter.textContent = Math.floor(count);

                requestAnimationFrame(update);

            }

            else{

                counter.textContent = target;

            }

        };

        update();

    });

}

/*=========================================================
SCROLL PROGRESS
=========================================================*/

function updateScrollProgress(){

    if(!scrollProgress) return;

    const winScroll = document.documentElement.scrollTop;

    const height =

    document.documentElement.scrollHeight -

    document.documentElement.clientHeight;

    const progress =

    (winScroll / height) * 100;

    scrollProgress.style.width = progress + "%";

}

/*=========================================================
BACK TO TOP
=========================================================*/

function toggleBackToTop(){

    if(!backToTop) return;

    if(window.scrollY > 400){

        backToTop.classList.add("show");

    }

    else{

        backToTop.classList.remove("show");

    }

}

/*=========================================================
NAVBAR EFFECT
=========================================================*/

function navbarEffect(){

    if(!navbar) return;

    if(window.scrollY > 50){

        navbar.style.padding = "12px 9%";

        navbar.style.background =

        "rgba(6,8,22,.95)";

    }

    else{

        navbar.style.padding = "18px 9%";

        navbar.style.background =

        "rgba(6,8,22,.82)";

    }

}



function analyzeReview(){

    const review = reviewInput.value.trim();

    if(review === ""){

        showToast("Please enter a customer review.","warning");

        return;

    }

    const result = analyzeSentiment(review);

    updateResult(result.sentiment,result.confidence);

    addToHistory(

        review,

        result.sentiment,

        result.confidence

    );

    updateDashboard();

    updateConfidenceStats();

    showToast("Analysis Completed","success");

}

/*=========================================================
AI SENTIMENT ANALYSIS
=========================================================*/

function analyzeSentiment(text){

    text = text.toLowerCase();

    let positiveScore = 0;
    let negativeScore = 0;

    positiveWords.forEach(word=>{

        if(text.includes(word)){

            positiveScore++;

        }

    });

    negativeWords.forEach(word=>{

        if(text.includes(word)){

            negativeScore++;

        }

    });

    const totalMatches = positiveScore + negativeScore;

    let sentiment = "NEUTRAL";
    let confidence = 0.50;

    if(totalMatches === 0){

        confidence = 0.50;

    }

    else if(positiveScore > negativeScore){

        sentiment = "POSITIVE";

        confidence = Math.min(
            0.60 + (positiveScore / totalMatches) * 0.40,
            0.99
        );

    }

    else if(negativeScore > positiveScore){

        sentiment = "NEGATIVE";

        confidence = Math.min(
            0.60 + (negativeScore / totalMatches) * 0.40,
            0.99
        );

    }

    else{

        sentiment = "NEUTRAL";

        confidence = 0.55;

    }

    return{

        sentiment,

        confidence

    };

}

/*=========================================================
CONFIDENCE CALCULATION
=========================================================*/

function calculateConfidence(high,low){

    let score =

    0.60 +

    ((high-low)*0.08);

    if(score>0.99){

        score=.99;

    }

    if(score<0.60){

        score=.60;

    }

    return score;

}

/*=========================================================
UPDATE RESULT
=========================================================*/

function updateResult(sentiment,confidence){

    sentimentResult.textContent = sentiment;

    confidenceScore.textContent =

    (confidence*100).toFixed(1)+"%";

    if(confidenceMeter){

        confidenceMeter.textContent =

        (confidence*100).toFixed(1)+"%";

    }

    confidenceFill.style.width=

    (confidence*100)+"%";

    progressFill.style.width="100%";

    switch(sentiment){

        case "POSITIVE":

            emoji.textContent="😊";

            sentimentResult.style.color="#22c55e";

            positive++;

            break;

        case "NEGATIVE":

            emoji.textContent="😞";

            sentimentResult.style.color="#ef4444";

            negative++;

            break;

        default:

            emoji.textContent="😐";

            sentimentResult.style.color="#f59e0b";

            neutral++;

    }

    total++;

    confidenceArray.push(confidence);

}

/*=========================================================
UPDATE DASHBOARD
=========================================================*/

function updateDashboard(){

    if(totalReviews)

        totalReviews.textContent=total;

    if(positiveReviews)

        positiveReviews.textContent=positive;

    if(negativeReviews)

        negativeReviews.textContent=negative;

    if(neutralReviews)

        neutralReviews.textContent=neutral;

}

/*=========================================================
CONFIDENCE STATISTICS
=========================================================*/

function updateConfidenceStats(){

    if(confidenceArray.length===0){

        return;

    }

    let sum=0;

    confidenceArray.forEach(score=>{

        sum+=score;

    });

    const average=

    sum/confidenceArray.length;

    avgConfidence.textContent=

    formatConfidence(average);

    highestConfidence.textContent=

    formatConfidence(

        Math.max(...confidenceArray)

    );

    lowestConfidence.textContent=

    formatConfidence(

        Math.min(...confidenceArray)

    );

}

/*=========================================================
FORMAT CONFIDENCE
=========================================================*/

function formatConfidence(value){

    return (value*100).toFixed(1)+"%";

}

/*=========================================================
CLEAR REVIEW
=========================================================*/

function clearReview(){

    reviewInput.value="";

    reviewInput.focus();

    sentimentResult.textContent="Waiting...";

    emoji.textContent="😊";

    confidenceScore.textContent="0%";

    if(confidenceMeter){

        confidenceMeter.textContent="0%";

    }

    confidenceFill.style.width="0%";

    progressFill.style.width="0%";

    showToast("Input Cleared","info");

}



function addToHistory(review,sentiment,confidence){

    const item={

        id:Date.now(),

        review:review,

        sentiment:sentiment,

        confidence:confidence,

        date:new Date().toLocaleString()

    };

    history.unshift(item);

    renderHistory();

}

/*=========================================================
RENDER HISTORY
=========================================================*/

function renderHistory(){

    if(!historyContainer) return;

    if(history.length===0){

        historyContainer.innerHTML=`

        <div class="empty-history">

            <i class="fa-solid fa-clock-rotate-left"></i>

            <h3>No Analysis History</h3>

            <p>Your analyzed reviews will appear here.</p>

        </div>

        `;

        return;

    }

    historyContainer.innerHTML="";

    history.forEach(item=>{

        historyContainer.innerHTML+=createHistoryCard(item);

    });

}

/*=========================================================
CREATE HISTORY CARD
=========================================================*/

function createHistoryCard(item){

    let badge="neutral-badge";

    if(item.sentiment==="POSITIVE"){

        badge="positive-badge";

    }

    else if(item.sentiment==="NEGATIVE"){

        badge="negative-badge";

    }

    return `

    <div class="history-card fade-in">

        <div class="history-top">

            <span class="${badge}">

                ${item.sentiment}

            </span>

            <span class="history-date">

                ${item.date}

            </span>

        </div>

        <p class="history-review">

            ${item.review}

        </p>

        <div class="history-bottom">

            <span>

                Confidence :

                ${(item.confidence*100).toFixed(1)}%

            </span>

            <div class="history-actions">

                <button

                class="copy-btn"

                onclick="copyReview(${item.id})">

                <i class="fa-solid fa-copy"></i>

                Copy

                </button>

                <button

                class="delete-btn"

                onclick="deleteHistory(${item.id})">

                <i class="fa-solid fa-trash"></i>

                Delete

                </button>

            </div>

        </div>

    </div>

    `;

}

/*=========================================================
DELETE HISTORY
=========================================================*/

function deleteHistory(id){

    history=history.filter(

        item=>item.id!==id

    );

    renderHistory();

    showToast(

        "History Deleted",

        "error"

    );

}

/*=========================================================
CLEAR HISTORY
=========================================================*/

function clearHistory(){

    if(history.length===0){

        showToast(

            "History Already Empty",

            "warning"

        );

        return;

    }

    history=[];

    renderHistory();

    showToast(

        "History Cleared",

        "success"

    );

}

/*=========================================================
COPY REVIEW
=========================================================*/

function copyReview(id){

    const item=

    history.find(

        review=>review.id===id

    );

    if(!item) return;

    navigator.clipboard.writeText(

        item.review

    );

    showToast(

        "Review Copied",

        "success"

    );

}

/*=========================================================
SEARCH HISTORY
=========================================================*/

function filterHistory(){

    const keyword=

    searchHistory.value

    .toLowerCase()

    .trim();

    const cards=

    document.querySelectorAll(

        ".history-card"

    );

    cards.forEach(card=>{

        const text=

        card.innerText.toLowerCase();

        if(text.includes(keyword)){

            card.style.display="block";

        }

        else{

            card.style.display="none";

        }

    });

}

/*=========================================================
INITIAL HISTORY
=========================================================*/

renderHistory();



function startVoiceRecognition(){

    if(!("webkitSpeechRecognition" in window) &&
       !("SpeechRecognition" in window)){

        showToast(

            "Speech Recognition is not supported.",

            "error"

        );

        return;

    }

    const SpeechRecognition =

    window.SpeechRecognition ||

    window.webkitSpeechRecognition;

    const recognition =

    new SpeechRecognition();

    recognition.lang="en-US";

    recognition.interimResults=false;

    recognition.maxAlternatives=1;

    voiceBtn.classList.add("voice-active");

    showToast(

        "Listening...",

        "info"

    );

    recognition.start();

    recognition.onresult=function(event){

        reviewInput.value=

        event.results[0][0].transcript;

        voiceBtn.classList.remove("voice-active");

        showToast(

            "Voice Captured",

            "success"

        );

    };

    recognition.onerror=function(){

        voiceBtn.classList.remove("voice-active");

        showToast(

            "Voice Recognition Failed",

            "error"

        );

    };

    recognition.onend=function(){

        voiceBtn.classList.remove("voice-active");

    };

}

/*=========================================================
EXPORT CSV
=========================================================*/

function exportHistory(){

    if(history.length===0){

        showToast(

            "No History Available",

            "warning"

        );

        return;

    }

    let csv=

    "Review,Sentiment,Confidence,Date\n";

    history.forEach(item=>{

        csv+=`"${item.review.replace(/"/g,'""')}",`;

        csv+=`${item.sentiment},`;

        csv+=`${(item.confidence*100).toFixed(1)}%,`;

        csv+=`"${item.date}"\n`;

    });

    const blob=

    new Blob(

        [csv],

        {type:"text/csv"}

    );

    const url=

    URL.createObjectURL(blob);

    const a=

    document.createElement("a");

    a.href=url;

    a.download="Sentiment_History.csv";

    document.body.appendChild(a);

    a.click();

    document.body.removeChild(a);

    URL.revokeObjectURL(url);

    showToast(

        "CSV Exported Successfully",

        "success"

    );

}

/*=========================================================
LIVE ANALYTICS
=========================================================*/

function toggleLiveAnalytics(){

    liveMode=!liveMode;

    if(liveMode){

        liveAnalyticsBtn.innerHTML=`

        <i class="fa-solid fa-pause"></i>

        Stop Live Analytics

        `;

        showToast(

            "Live Analytics Enabled",

            "success"

        );

    }

    else{

        liveAnalyticsBtn.innerHTML=`

        <i class="fa-solid fa-chart-line"></i>

        Live Analytics

        `;

        showToast(

            "Live Analytics Disabled",

            "warning"

        );

    }

}

/*=========================================================
KEYBOARD SHORTCUTS
=========================================================*/

document.addEventListener(

"keydown",

function(event){

    if(event.ctrlKey && event.key==="Enter"){

        event.preventDefault();

        analyzeReview();

    }

    if(event.ctrlKey &&

       event.key.toLowerCase()==="l"){

        event.preventDefault();

        clearReview();

    }

    if(event.ctrlKey &&

       event.key.toLowerCase()==="e"){

        event.preventDefault();

        exportHistory();

    }

});

/*=========================================================
TOAST NOTIFICATION
=========================================================*/

function showToast(message,type="info"){

    const toast=

    document.createElement("div");

    toast.className=`toast ${type}`;

    toast.textContent=message;

    document.body.appendChild(toast);

    setTimeout(()=>{

        toast.classList.add("show");

    },100);

    setTimeout(()=>{

        toast.classList.remove("show");

        setTimeout(()=>{

            toast.remove();

        },400);

    },3000);

}



let sentimentPieChart = null;

let sentimentBarChart = null;

/*=========================================================
INITIALIZE CHARTS
=========================================================*/

function initializeCharts(){

    initializePieChart();

    initializeBarChart();

}

/*=========================================================
PIE CHART
=========================================================*/

function initializePieChart(){

    const canvas = document.getElementById("sentimentPieChart");

    if(!canvas) return;

    sentimentPieChart = new Chart(canvas,{

        type:"pie",

        data:{

            labels:[

                "Positive",

                "Negative",

                "Neutral"

            ],

            datasets:[{

                data:[0,0,0],

                backgroundColor:[

                    "#22c55e",

                    "#ef4444",

                    "#f59e0b"

                ],

                borderWidth:2,

                borderColor:"#ffffff"

            }]

        },

        options:{

            responsive:true,

            maintainAspectRatio:false,

            plugins:{

                legend:{

                    labels:{

                        color:"#ffffff",

                        font:{

                            size:14

                        }

                    }

                }

            }

        }

    });

}

/*=========================================================
BAR CHART
=========================================================*/

function initializeBarChart(){

    const canvas = document.getElementById("sentimentBarChart");

    if(!canvas) return;

    sentimentBarChart = new Chart(canvas,{

        type:"bar",

        data:{

            labels:[

                "Positive",

                "Negative",

                "Neutral"

            ],

            datasets:[{

                label:"Reviews",

                data:[0,0,0],

                backgroundColor:[

                    "#22c55e",

                    "#ef4444",

                    "#f59e0b"

                ],

                borderRadius:10

            }]

        },

        options:{

            responsive:true,

            maintainAspectRatio:false,

            scales:{

                y:{

                    beginAtZero:true,

                    ticks:{

                        color:"#ffffff"

                    },

                    grid:{

                        color:"rgba(255,255,255,.1)"

                    }

                },

                x:{

                    ticks:{

                        color:"#ffffff"

                    },

                    grid:{

                        display:false

                    }

                }

            },

            plugins:{

                legend:{

                    display:false

                }

            }

        }

    });

}

/*=========================================================
UPDATE CHARTS
=========================================================*/

function updateCharts(){

    if(sentimentPieChart){

        sentimentPieChart.data.datasets[0].data=[

            positive,

            negative,

            neutral

        ];

        sentimentPieChart.update();

    }

    if(sentimentBarChart){

        sentimentBarChart.data.datasets[0].data=[

            positive,

            negative,

            neutral

        ];

        sentimentBarChart.update();

    }

}

/*=========================================================
UPDATE LIVE ANALYTICS
=========================================================*/

function updateLiveAnalytics(){

    if(!liveMode) return;

    updateCharts();

}

/*=========================================================
AUTO REFRESH
=========================================================*/

setInterval(()=>{

    if(liveMode){

        updateLiveAnalytics();

    }

},1000);

/*=========================================================
INITIALIZE AFTER PAGE LOAD
=========================================================*/

window.addEventListener("load",()=>{

    initializeCharts();

});

/*=========================================================
MODIFY DASHBOARD UPDATE
=========================================================*/

const originalDashboardUpdate = updateDashboard;

updateDashboard = function(){

    originalDashboardUpdate();

    updateCharts();

};



const accuracyValue =
document.getElementById("accuracyValue");

const avgConfidenceValue =
document.getElementById("avgConfidenceValue");

const totalPredictionValue =
document.getElementById("totalPredictionValue");

const satisfactionValue =
document.getElementById("satisfactionValue");

/*=========================================================
UPDATE PERFORMANCE DASHBOARD
=========================================================*/

function updatePerformanceDashboard(){

    updateAccuracy();

    updateAverageConfidence();

    updateCustomerSatisfaction();

    updatePredictionCount();

}

/*=========================================================
AI ACCURACY
=========================================================*/

function updateAccuracy(){

    if(!accuracyValue) return;

    let accuracy = 100;

    if(total>0){

        accuracy =

        ((positive+negative)/total)*100;

    }

    animateValue(

        accuracyValue,

        accuracy,

        "%"

    );

}

/*=========================================================
AVERAGE CONFIDENCE
=========================================================*/

function updateAverageConfidence(){

    if(!avgConfidenceValue) return;

    if(confidenceArray.length===0){

        avgConfidenceValue.textContent="0%";

        return;

    }

    let sum=0;

    confidenceArray.forEach(score=>{

        sum+=score;

    });

    const average=

    (sum/confidenceArray.length)*100;

    animateValue(

        avgConfidenceValue,

        average,

        "%"

    );

}

/*=========================================================
CUSTOMER SATISFACTION
=========================================================*/

function updateCustomerSatisfaction(){

    if(!satisfactionValue) return;

    let satisfaction=0;

    if(total>0){

        satisfaction=

        (positive/total)*100;

    }

    animateValue(

        satisfactionValue,

        satisfaction,

        "%"

    );

}

/*=========================================================
TOTAL PREDICTIONS
=========================================================*/

function updatePredictionCount(){

    if(!totalPredictionValue) return;

    animateValue(

        totalPredictionValue,

        total,

        ""

    );

}

/*=========================================================
ANIMATE VALUES
=========================================================*/

function animateValue(

element,

target,

suffix=""

){

    let start=0;

    const duration=800;

    const increment=

    target/(duration/20);

    const timer=

    setInterval(()=>{

        start+=increment;

        if(start>=target){

            start=target;

            clearInterval(timer);

        }

        element.textContent=

        start.toFixed(0)+suffix;

    },20);

}

/*=========================================================
UPDATE DASHBOARD
=========================================================*/

const previousUpdateDashboard = updateDashboard;

updateDashboard = function(){

    previousUpdateDashboard();

    updatePerformanceDashboard();

};

/*=========================================================
INITIALIZE PERFORMANCE
=========================================================*/

window.addEventListener("load",()=>{

    updatePerformanceDashboard();

});



const loader = document.querySelector(".loader");

const themeToggle = document.getElementById("themeToggle");

const revealElements = document.querySelectorAll(".reveal");

const navLinks = document.querySelectorAll(".nav-links a");

/*=========================================================
LOADER
=========================================================*/

window.addEventListener("load",()=>{

    if(loader){

        setTimeout(()=>{

            loader.classList.add("hidden");

        },1200);

    }

});

/*=========================================================
THEME TOGGLE
=========================================================*/

function toggleTheme(){

    document.body.classList.toggle("light-theme");

    const isLight=

    document.body.classList.contains(

        "light-theme"

    );

    localStorage.setItem(

        "theme",

        isLight?"light":"dark"

    );

    if(themeToggle){

        themeToggle.innerHTML=isLight ?

        '<i class="fa-solid fa-moon"></i>' :

        '<i class="fa-solid fa-sun"></i>';

    }

}

/*=========================================================
LOAD SAVED THEME
=========================================================*/

(function(){

    const saved=

    localStorage.getItem("theme");

    if(saved==="light"){

        document.body.classList.add(

            "light-theme"

        );

        if(themeToggle){

            themeToggle.innerHTML=

            '<i class="fa-solid fa-moon"></i>';

        }

    }

})();

if(themeToggle){

    themeToggle.addEventListener(

        "click",

        toggleTheme

    );

}

/*=========================================================
SCROLL REVEAL
=========================================================*/

function revealOnScroll(){

    revealElements.forEach(item=>{

        const windowHeight=

        window.innerHeight;

        const top=

        item.getBoundingClientRect().top;

        const visible=120;

        if(top<windowHeight-visible){

            item.classList.add("active");

        }

    });

}

window.addEventListener(

    "scroll",

    revealOnScroll

);

revealOnScroll();

/*=========================================================
SMOOTH NAVIGATION
=========================================================*/

navLinks.forEach(link=>{

    link.addEventListener(

        "click",

        function(e){

            e.preventDefault();

            const target=

            document.querySelector(

                this.getAttribute("href")

            );

            if(target){

                target.scrollIntoView({

                    behavior:"smooth"

                });

            }

        }

    );

});

/*=========================================================
BACK TO TOP
=========================================================*/

window.addEventListener(

    "scroll",

    ()=>{

        if(window.scrollY>500){

            backToTop.classList.add(

                "show"

            );

        }

        else{

            backToTop.classList.remove(

                "show"

            );

        }

    }

);

/*=========================================================
RANDOM ID
=========================================================*/

function generateID(){

    return Math.random()

    .toString(36)

    .substring(2,10);

}

/*=========================================================
FORMAT DATE
=========================================================*/

function formatDate(){

    return new Date()

    .toLocaleString();

}

/*=========================================================
RESET DASHBOARD
=========================================================*/

function resetDashboard(){

    positive=0;

    negative=0;

    neutral=0;

    total=0;

    confidenceArray=[];

    updateDashboard();

    updateCharts();

    updateConfidenceStats();

    updatePerformanceDashboard();

}

/*=========================================================
AUTO SAVE HISTORY
=========================================================*/

window.addEventListener(

    "beforeunload",

    ()=>{

        localStorage.setItem(

            "history",

            JSON.stringify(history)

        );

    }

);

/*=========================================================
LOAD HISTORY
=========================================================*/

(function(){

    const data=

    localStorage.getItem(

        "history"

    );

    if(data){

        history=

        JSON.parse(data);

        renderHistory();

    }

})();



const insightContainer =
document.getElementById("aiInsights");

const typingElement =
document.getElementById("typingText");

/*=========================================================
AI BUSINESS INSIGHTS
=========================================================*/

function generateInsights(){

    if(!insightContainer) return;

    let insights=[];

    if(total===0){

        insights.push(
        "Start analyzing customer reviews to generate AI insights."
        );
    }

    else{

        if(positive>negative){

            insights.push(
            "Overall customer satisfaction is excellent."
            );

            insights.push(
            "Customers are responding positively to your products."
            );

        }

        if(negative>positive){

            insights.push(
            "Negative reviews are increasing."
            );

            insights.push(
            "Improve customer support and product quality."
            );

        }

        if(neutral>=positive && neutral>=negative){

            insights.push(
            "Many customers have neutral opinions."
            );

            insights.push(
            "Encourage customers to provide detailed feedback."
            );

        }

        if(confidenceArray.length>0){

            const avg=

            confidenceArray.reduce(

            (a,b)=>a+b,0

            )/confidenceArray.length;

            if(avg>0.90){

                insights.push(
                "AI confidence is extremely high."
                );
            }

            else if(avg>0.75){

                insights.push(
                "Prediction confidence is good."
                );
            }

            else{

                insights.push(
                "Confidence is moderate. More reviews can improve analytics."
                );
            }

        }

    }

    insightContainer.innerHTML="";

    insights.forEach(text=>{

        insightContainer.innerHTML+=`

        <div class="insight-item">

            <i class="fa-solid fa-lightbulb"></i>

            <span>${text}</span>

        </div>

        `;

    });

}

/*=========================================================
TYPING ANIMATION
=========================================================*/

const typingTexts=[

"AI Sentiment Analysis Dashboard",

"Analyze Customer Reviews",

"Powered by Artificial Intelligence",

"Business Intelligence Analytics"

];

let typingIndex=0;

let characterIndex=0;

let deleting=false;

function typingEffect(){

    if(!typingElement) return;

    const current=

    typingTexts[typingIndex];

    if(!deleting){

        typingElement.textContent=

        current.substring(

        0,

        characterIndex++

        );

        if(characterIndex>

        current.length){

            deleting=true;

            setTimeout(

            typingEffect,

            1500

            );

            return;

        }

    }

    else{

        typingElement.textContent=

        current.substring(

        0,

        characterIndex--

        );

        if(characterIndex===0){

            deleting=false;

            typingIndex++;

            if(

            typingIndex===

            typingTexts.length

            ){

                typingIndex=0;

            }

        }

    }

    setTimeout(

    typingEffect,

    deleting?40:90

    );

}

typingEffect();

/*=========================================================
PARTICLES.JS
=========================================================*/

window.addEventListener("load", function () {

    particlesJS("particles-js", {

        particles: {
            number: { value: 100 },
            color: { value: "#FFD700" },
            shape: { type: "circle" },
            opacity: { value: 0.5 },
            size: { value: 3 },
            move: {
                enable: true,
                speed: 2
            },
            line_linked: {
                enable: true,
                color: "#FFD700",
                opacity: 0.4
            }
        }

    });

});

/*=========================================================
PERFORMANCE MONITOR
=========================================================*/

function monitorPerformance(){

    console.log(

    "========== DASHBOARD =========="

    );

    console.log(

    "Total Reviews:",

    total

    );

    console.log(

    "Positive:",

    positive

    );

    console.log(

    "Negative:",

    negative

    );

    console.log(

    "Neutral:",

    neutral

    );

    console.log(

    "Confidence Entries:",

    confidenceArray.length

    );

}

/*=========================================================
AUTO UPDATE INSIGHTS
=========================================================*/

const previousPerformance=

updatePerformanceDashboard;

updatePerformanceDashboard=function(){

    previousPerformance();

    generateInsights();

};

/*=========================================================
AUTO MONITOR
=========================================================*/

setInterval(()=>{

    if(liveMode){

        monitorPerformance();

    }

},10000);



window.addEventListener("online",()=>{

    showToast(

        "Internet Connection Restored",

        "success"

    );

});

window.addEventListener("offline",()=>{

    showToast(

        "You are Offline",

        "warning"

    );

});

/*=========================================================
BROWSER NOTIFICATIONS
=========================================================*/

function requestNotificationPermission(){

    if(!("Notification" in window)){

        return;

    }

    if(Notification.permission==="default"){

        Notification.requestPermission();

    }

}

function sendNotification(title,message){

    if(!("Notification" in window)){

        return;

    }

    if(Notification.permission==="granted"){

        new Notification(title,{

            body:message,

            icon:"favicon.ico"

        });

    }

}

/*=========================================================
AUTO NOTIFICATION
=========================================================*/

function notifyAnalysisComplete(){

    sendNotification(

        "Analysis Completed",

        "Your customer review has been analyzed successfully."

    );

}

/*=========================================================
GLOBAL ERROR HANDLER
=========================================================*/

window.addEventListener("error",(event)=>{

    console.error(

        "Application Error:",

        event.message

    );

    showToast(

        "Unexpected Error Occurred",

        "error"

    );

});

/*=========================================================
UNHANDLED PROMISES
=========================================================*/

window.addEventListener(

    "unhandledrejection",

    (event)=>{

        console.error(

            event.reason

        );

    }

);

/*=========================================================
ACCESSIBILITY
=========================================================*/

document.addEventListener(

"keydown",

function(event){

    if(event.key==="Escape"){

        clearReview();

    }

});

/*=========================================================
AUTO SAVE INPUT
=========================================================*/

reviewInput?.addEventListener(

"input",

()=>{

    localStorage.setItem(

        "draftReview",

        reviewInput.value

    );

});

/*=========================================================
RESTORE INPUT
=========================================================*/

window.addEventListener(

"load",

()=>{

    const draft=

    localStorage.getItem(

        "draftReview"

    );

    if(draft){

        reviewInput.value=draft;

    }

});

/*=========================================================
PAGE VISIBILITY
=========================================================*/

document.addEventListener(

"visibilitychange",

()=>{

    if(document.hidden){

        console.log(

        "Dashboard Hidden"

        );

    }

    else{

        console.log(

        "Dashboard Active"

        );

    }

});

/*=========================================================
SESSION STORAGE
=========================================================*/

function saveSession(){

    sessionStorage.setItem(

        "dashboardData",

        JSON.stringify({

            total,

            positive,

            negative,

            neutral

        })

    );

}

function restoreSession(){

    const data=

    sessionStorage.getItem(

        "dashboardData"

    );

    if(!data) return;

    const stats=

    JSON.parse(data);

    total=stats.total;

    positive=stats.positive;

    negative=stats.negative;

    neutral=stats.neutral;

    updateDashboard();

}

/*=========================================================
AUTO SAVE SESSION
=========================================================*/

setInterval(()=>{

    saveSession();

},5000);

/*=========================================================
INITIALIZE
=========================================================*/

window.addEventListener("load",()=>{

    requestNotificationPermission();

    restoreSession();

});

/*=========================================================
UPDATE ANALYSIS
=========================================================*/

const originalAnalyzeReview=analyzeReview;

analyzeReview=function(){

    originalAnalyzeReview();

    notifyAnalysisComplete();

};



const APP = {

    name: "AI Sentiment Analysis Dashboard",

    version: "1.0.0",

    developer: "Rohan Bhowmik"

};

/*=========================================================
INITIALIZE APPLICATION
=========================================================*/

function initializeApplication(){

    console.clear();

    console.log("========================================");

    console.log(APP.name);

    console.log("Version :", APP.version);

    console.log("Developer :", APP.developer);

    console.log("========================================");

    renderHistory();

    updateDashboard();

    updateConfidenceStats();

    updatePerformanceDashboard();

    updateCharts();

    generateInsights();

    revealOnScroll();

}

/*=========================================================
AUTO SAVE HISTORY
=========================================================*/

function saveHistory(){

    try{

        localStorage.setItem(

            "history",

            JSON.stringify(history)

        );

    }

    catch(error){

        console.error(error);

    }

}

/*=========================================================
AUTO SAVE
=========================================================*/

setInterval(function(){

    saveHistory();

},10000);

/*=========================================================
MEMORY CLEANUP
=========================================================*/

window.addEventListener(

"beforeunload",

function(){

    saveHistory();

    confidenceArray = [...confidenceArray];

    history = [...history];

});

/*=========================================================
PERFORMANCE LOGGER
=========================================================*/

function printStatistics(){

    console.table({

        Reviews: total,

        Positive: positive,

        Negative: negative,

        Neutral: neutral,

        Confidence: confidenceArray.length

    });

}

/*=========================================================
AUTO PERFORMANCE REPORT
=========================================================*/

setInterval(function(){

    if(liveMode){

        printStatistics();

    }

},15000);

/*=========================================================
REFRESH LIVE DASHBOARD
=========================================================*/

setInterval(function(){

    if(liveMode){

        updateDashboard();

        updateCharts();

        updatePerformanceDashboard();

        generateInsights();

    }

},2000);

/*=========================================================
WINDOW RESIZE
=========================================================*/

window.addEventListener(

"resize",

function(){

    if(sentimentPieChart){

        sentimentPieChart.resize();

    }

    if(sentimentBarChart){

        sentimentBarChart.resize();

    }

});

/*=========================================================
WELCOME MESSAGE
=========================================================*/

window.addEventListener(

"load",

function(){

    setTimeout(function(){

        showToast(

            "Welcome to AI Sentiment Analysis Dashboard",

            "success"

        );

    },800);

});

/*=========================================================
INITIALIZE AFTER PAGE LOAD
=========================================================*/

window.addEventListener(

"load",

initializeApplication

);

