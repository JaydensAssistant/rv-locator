<%*
const rv = await tp.user.newRv(tp);
-%>
---
Address: "<% rv.addressYaml %>"
Priority: <% rv.priority %>
Met: "<% rv.created %>"
Last Spoke: "<% rv.created %>"
Last Attempted: "<% rv.created %>"
<% rv.companionYaml %>
Visits: 1
Successful Visits: 1
icon: door-open
color: purple
Hub:
  - "[[Return Visits Hub]]"
cssclasses:
  - hide-props
  - rv-dashboard
---

> [!quote] RV Dashboard
>**Hubs:** `INPUT[inlineListSuggester(optionQuery("")):Hub]`
>**Address:** `INPUT[text:Address]` [🗺️](<% rv.mapUrl %>)
> 
> `BUTTON[rv-log-home, rv-log-miss, rv-log-past, rv-archive]`
>
> > [!rv]- Quick Facts
> >
> >**Priority**
> > `INPUT[slider(minValue(0), maxValue(5)):Priority]` `VIEW[{Priority}]`
> >
> >**Visits**
> >
> > `INPUT[number:Visits]`
> >
> > **Successful Visits**
> > `INPUT[number:["Successful Visits"]]`
> > 
> > **Met**
> >`INPUT[dateTime:["Met"]]`
> >
> >**Last Spoke**
> >`INPUT[dateTime:["Last Spoke"]]`
> >
> >**Last Attempted**
> >`INPUT[dateTime:["Last Attempted"]]`
> >
> >**Met With**
> >`INPUT[text:["Met With"]]`
> >
> >**Taken**
> >`INPUT[inlineList:Taken]`

---
### Visit Notes:
##### <% rv.stamp %> <span class="rv-stamp-ago"><% rv.ago %></span>
`INPUT[textArea:sVisit1Notes]`

---
> [!example] Return Suggestions
> No May-go-out days
>
> > [!note]- Attempt Log
> >
> >| | Mor | Aft | Eve |
> >| --- | --- | --- | --- |
> >| Sun | 0/0 | 0/0 | 0/0 |
> >| Mon | 0/0 | 0/0 | 0/0 |
> >| Tue | 0/0 | 0/0 | 0/0 |
> >| Wed | 0/0 | 0/0 | 0/0 |
> >| Thu | 0/0 | 0/0 | 0/0 |
> >| Fri | 0/0 | 0/0 | 0/0 |
> >| Sat | 0/0 | 0/0 | 0/0 |
> >
> >- <% rv.stamp %> — success<% rv.companionSuffix %>

```meta-bind-button
label: ""
icon: door-open
tooltip: Home
style: primary
class: rv-visit-btn
id: rv-log-home
hidden: true
actions:
  - type: runTemplaterFile
    templateFile: Templates/99 RV Log Home.md
```

```meta-bind-button
label: ""
icon: door-closed
tooltip: Not home
style: default
class: rv-visit-btn
id: rv-log-miss
hidden: true
actions:
  - type: runTemplaterFile
    templateFile: Templates/99 RV Log Miss.md
```

```meta-bind-button
label: ""
icon: rotate-ccw-clock
tooltip: Log past visit
style: default
class: rv-visit-btn
id: rv-log-past
hidden: true
actions:
  - type: command
    command: rv-locator:log-past-visit
```

```meta-bind-button
label: ""
icon: archive
tooltip: Archive
style: default
class: rv-visit-btn
id: rv-archive
hidden: true
actions:
  - type: command
    command: rv-locator:archive-rv
```
