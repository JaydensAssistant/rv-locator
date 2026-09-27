<%*
const rv = await tp.user.newRv(tp);
-%>
---
Address: "<% rv.addressYaml %>"
Priority: 0
Met: "<% rv.created %>"
Last Spoke: "<% rv.created %>"
Last Attempted: "<% rv.created %>"
Met With:
Taken:
Visits: 0
icon: door-open
color: purple
Hub:
  - "[[Return Visits Hub]]"
cssclasses:
  - "hide-props"
  - "rv-dashboard"
---
> [!info]+ 👤 RV Dashboard
>
> **Hub**
> `INPUT[inlineListSuggester(optionQuery("")):Hub]`
>
> **Address**
> `INPUT[text:Address]`
>
> **Priority**
> `INPUT[slider(minValue(0), maxValue(5)):Priority]` `VIEW[{Priority}]`
>
> **Met**
> `INPUT[dateTime:["Met"]]`
>
> **Met With**
> `INPUT[text:["Met With"]]`
>
> **Last Spoke**
> `INPUT[dateTime:["Last Spoke"]]`
>
> **Taken**
> `INPUT[inlineList:Taken]`
>
> **Visits**
> `INPUT[number:Visits]`

## <% rv.stamp %>

## Attempt Log
- <% rv.stamp %> — success
